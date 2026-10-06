import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLessons,createLessonAIService} from '../src/lesson-ai.mjs';
import {prepareTransfer,prepareTransferAudit,publishTransferFeedback} from '../src/transfer-feedback.mjs';
import {createJourney,transition,validFeedback,feedbackVerdict} from '../src/web/flow.js';
const lessons=await loadLessons();
const input={topicId:'tathabbut',answer:'أراجع موقع الجهة الرسمي، وأتأكد من سنة الإعلان'};
const proposal={mode:'feedback',checks:{source:{state:'supported',evidence:'e1'},year:{state:'supported',evidence:'e2'},deadline:{state:'not_shown',evidence:'none'}}};
const audit=structuredClone(proposal);
const reply=raw=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}));
test('feedback accepts only a known scenario and minimal bounded answer, with scenario-specific criteria',()=>{
 for(const bad of [{...input,topicId:'../secret'},{...input,context:'custom'},{...input,answer:' '},{...input,answer:'أ'.repeat(401)}])assert.throws(()=>prepareTransfer(bad,lessons));
 for(const [topicId,lesson] of lessons){
  const p=prepareTransfer({topicId,answer:input.answer},lessons);
  assert.deepEqual(Object.keys(p.schema.properties.checks.properties),Object.keys(lesson.topic.refs.transferFeedback.criteria));
  const context=JSON.parse(p.policy.split('السياق الموثوق:\n')[1]);
  assert.equal(context.scenario,lesson.records.find(r=>r.id===lesson.topic.refs.transfer).text);
 }
});
test('model cannot invent a quote, grade, criterion or positive claim without evidence',()=>{
 const p=prepareTransfer(input,lessons);assert.deepEqual(p.normalize(proposal),proposal);
 for(const mutate of [x=>x.grade=10,x=>x.checks.source.evidence='invented',x=>x.checks.source.evidence='none',x=>x.checks.deadline.evidence='e1',x=>x.checks.extra=x.checks.source,x=>x.mode='clarify']){
  const raw=structuredClone(proposal);mutate(raw);assert.equal(p.normalize(raw),null);
 }
});
test('second reading classifies all criteria without seeing the proposed result; disagreements are withheld',()=>{
 const p=prepareTransferAudit(input,lessons,proposal);
 assert.equal(p.normalize({mode:'feedback',checks:{source:proposal.checks.source}}),null);
 assert.equal(p.normalize({...audit,comment:'invented'}),null);
 assert.deepEqual(Object.keys(p.payload).sort(),['answer','excerpts']);
 const second=structuredClone(audit);second.checks.source={state:'opposed',evidence:'e1'};
 const result=publishTransferFeedback(input,lessons,proposal,second);
 assert.deepEqual(result.strengths,[{criterion:'year',evidence:'وأتأكد من سنة الإعلان'}]);
 assert.deepEqual(result.additions,[{criterion:'deadline',kind:'not_shown',evidence:''}]);
 second.checks.year={state:'uncertain',evidence:'none'};
 assert.equal(publishTransferFeedback(input,lessons,proposal,second).status,'unverified');
});
test('a second pass can abstain even when first pass proposes praise',()=>{
 for(const mode of ['clarify','outside']){
  const second={mode,checks:Object.fromEntries(Object.keys(proposal.checks).map(id=>[id,{state:'uncertain',evidence:'none'}]))};
  const result=publishTransferFeedback(input,lessons,proposal,second);
  assert.equal(result.status,'unverified');assert.deepEqual(result.strengths,[]);assert.deepEqual(result.additions,[]);
 }
});
test('server performs two bounded calls, sends no initial reasons, and exposes only curated criterion references',async()=>{
 const bodies=[];const service=await createLessonAIService({lessons,provider:'groq',apiKey:'test-private',fetchImpl:async(url,o)=>{bodies.push(JSON.parse(o.body));return reply(bodies.length===1?proposal:audit);}});
 const result=await service.feedback(input);assert.equal(result.status,'ok');assert.equal(bodies.length,2);
 assert.deepEqual(Object.keys(JSON.parse(bodies[0].messages[1].content)).sort(),['answer','excerpts']);
 assert.deepEqual(Object.keys(JSON.parse(bodies[1].messages[1].content)).sort(),['answer','excerpts']);
 assert.ok(bodies.every(x=>x.temperature===0&&x.max_completion_tokens===2048));
 assert.equal(result.strengths[0].evidence,'أراجع موقع الجهة الرسمي');assert.ok(!JSON.stringify(result).includes('test-private'));
});
test('vague/outside outputs stop after one call and cannot carry claims',async()=>{
 for(const mode of ['clarify','outside']){
  let calls=0;const raw={mode,checks:Object.fromEntries(Object.keys(proposal.checks).map(id=>[id,{state:'uncertain',evidence:'none'}]))};
  const service=await createLessonAIService({lessons,provider:'groq',apiKey:'test-private',fetchImpl:async()=>{calls++;return reply(raw);}});
  assert.equal((await service.feedback(input)).status,mode==='clarify'?'unclear':'outside');assert.equal(calls,1);
 }
});
test('missing key, PII in multiple digit scripts and links never send transfer answers externally',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error();};
 const service=await createLessonAIService({lessons,provider:'groq',apiKey:'test-private',fetchImpl});
 for(const answer of ['test@example.invalid','٠٥٠٠٠٠٠٠٠٠','۰۵۰۰۰۰۰۰۰۰','https://example.invalid/'])assert.equal((await service.feedback({...input,answer})).status,'privacy');
 const missing=await createLessonAIService({lessons,provider:'groq',apiKey:'',fetchImpl});assert.equal((await missing.feedback(input)).status,'not_configured');assert.equal(calls,0);
});
test('audit failure and shared budget exhaustion suppress all proposed feedback without retry',async()=>{
 for(const auditResponse of [new Response('',{status:503}),reply({mode:'feedback',checks:{}})]){
  let calls=0;const service=await createLessonAIService({lessons,provider:'groq',apiKey:'test-private',fetchImpl:async()=>++calls===1?reply(proposal):auditResponse});
  const result=await service.feedback(input);assert.notEqual(result.status,'ok');assert.deepEqual(result.strengths,[]);assert.equal(calls,2);
 }
 let calls=0;const service=await createLessonAIService({lessons,provider:'groq',apiKey:'test-private',maxRequests:1,fetchImpl:async()=>{calls++;return reply(proposal);}});
 assert.equal((await service.feedback(input)).status,'budget_exhausted');assert.equal(calls,1);
 assert.equal((await service.analyze({topicId:'tathabbut',initial:{choice:'verify',reason:'أراجع المصدر'},revised:{choice:'verify',reason:'أراجع المصدر'}})).status,'budget_exhausted');
});
test('browser rejects tampered claims or quotes and preserves uncertainty without grading',()=>{
 const result=publishTransferFeedback(input,lessons,proposal,audit);const ids=Object.keys(proposal.checks);
 assert.ok(validFeedback(result,ids,input.answer));
 for(const bad of [{...result,grade:10},{...result,status:'grade'},{...result,strengths:[{criterion:'source',evidence:'invented'}]},{...result,strengths:[...result.strengths,result.strengths[0]]},{...result,status:'unclear'}])assert.equal(validFeedback(bad,ids,input.answer),false);
 assert.ok(validFeedback({status:'unclear',strengths:[],additions:[]},ids,input.answer));
});
test('overall verdict separates full support, omission, contradiction and incomplete verification',()=>{
 const ids=Object.keys(proposal.checks),quote='أراجع موقع الجهة الرسمي';
 const full={status:'ok',strengths:ids.map(criterion=>({criterion,evidence:quote})),additions:[]};
 assert.equal(feedbackVerdict(full,ids,input.answer),'appropriate');
 const gap={status:'ok',strengths:full.strengths.slice(0,2),additions:[{criterion:'deadline',kind:'not_shown',evidence:''}]};
 assert.equal(feedbackVerdict(gap,ids,input.answer),'needs_addition');
 const wrong={...gap,additions:[{criterion:'deadline',kind:'opposed',evidence:quote}]};
 assert.equal(feedbackVerdict(wrong,ids,input.answer),'needs_correction');
 assert.equal(feedbackVerdict({...full,strengths:full.strengths.slice(0,1)},ids,input.answer),'partial');
 assert.equal(feedbackVerdict({status:'ok',strengths:[],additions:wrong.additions},ids,input.answer),'needs_correction');
 for(const status of ['unverified','outside','unavailable','unclear'])assert.equal(feedbackVerdict({status,strengths:[],additions:[]},ids,input.answer),null);
 assert.equal(feedbackVerdict({...full,strengths:[{criterion:'source',evidence:'invented'}]},ids,input.answer),null);
});
test('confirmed opposition survives both readings and cannot turn into praise; absence alone is not wrong',()=>{
 const first=structuredClone(proposal);first.checks.source={state:'opposed',evidence:'e1'};
 const second=structuredClone(first);second.checks.year={state:'not_shown',evidence:'none'};
 const result=publishTransferFeedback(input,lessons,first,second);
 assert.deepEqual(result.strengths,[]);
 assert.deepEqual(result.additions,[{criterion:'source',kind:'opposed',evidence:'أراجع موقع الجهة الرسمي'},{criterion:'deadline',kind:'not_shown',evidence:''}]);
 const omissions={mode:'feedback',checks:Object.fromEntries(Object.keys(first.checks).map(id=>[id,{state:'not_shown',evidence:'none'}]))};
 assert.equal(publishTransferFeedback(input,lessons,omissions,omissions).status,'unverified');
});
test('when readings agree on the state the second evidence is used, but an uncertain point is withheld',()=>{
 const second=structuredClone(proposal);second.checks.source.evidence='e3';
 second.checks.deadline={state:'uncertain',evidence:'none'};
 const result=publishTransferFeedback(input,lessons,proposal,second);
 assert.equal(result.strengths[0].evidence,input.answer);
 assert.equal(result.additions.length,0);
 assert.equal(feedbackVerdict(result,Object.keys(proposal.checks),input.answer),'partial');
});
test('one optional correction replaces misunderstanding; personalized transfer waits and permits one clarification',()=>{
 let s=createJourney();
 s=transition(s,{type:'DECIDE',choice:'verify',reason:'أتحقق'});s=transition(s,{type:'REVISE',choice:'verify',reason:'أتحقق من الموقع'});
 s=transition(s,{type:'ANALYSIS',route:'source_context',status:'ok',evidence:'أتحقق من الموقع'});
 s=transition(s,{type:'CORRECT_REASON',reason:'أراجع الموقع الرسمي والسنة'});assert.equal(s.stage,'followup');assert.equal(s.route,null);
 s=transition(s,{type:'ANALYSIS',route:'source_context',status:'ok',evidence:'أراجع الموقع الرسمي والسنة'});
 assert.throws(()=>transition(s,{type:'CORRECT_REASON',reason:'تصحيح آخر'}));
 s=transition(s,{type:'TRANSFER'});s=transition(s,{type:'FINISH',reason:'كذا'});assert.equal(s.stage,'transfer_review');
 s=transition(s,{type:'TRANSFER_FEEDBACK',feedback:{status:'unclear',strengths:[],additions:[]}});assert.equal(s.stage,'complete');
 s=transition(s,{type:'REVIEW_TRANSFER'});s=transition(s,{type:'FINISH',reason:input.answer});
 s=transition(s,{type:'TRANSFER_FEEDBACK',feedback:publishTransferFeedback(input,lessons,proposal,audit)});
 assert.throws(()=>transition(s,{type:'REVIEW_TRANSFER'}));assert.equal(s.transferAnswer,input.answer);
});
