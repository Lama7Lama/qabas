import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLessons,prepareLesson,createLessonAIService} from '../src/lesson-ai.mjs';
import {createJourney,transition} from '../src/web/flow.js';
import {validateContent,recordHash} from '../src/content.mjs';
const lessons=await loadLessons();
const input={topicId:'amanah',initial:{choice:'keep',reason:'initial-canary سبب أول افتراضي'},revised:{choice:'return',reason:'لا أتصرف في مال غيري، دون إذن'}};
const reply=raw=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}));
test('all six contracts reach explanation without a mandatory extra answer',()=>{
 for(const lesson of lessons.values()){
  const r=lesson.topic.refs,values=r.choices.map(id=>lesson.records.find(x=>x.id===id).value);
  let s=createJourney({choices:values,routes:Object.keys(r.followups)});
  assert.throws(()=>transition(s,{type:'DECIDE',choice:'bogus',reason:'لسبب'}));
  s=transition(s,{type:'DECIDE',choice:values[0],reason:'لا أعرف'});
  s=transition(s,{type:'REVISE',choice:values[1],reason:'لسبب مختلف'});
  s=transition(s,{type:'ANALYSIS',route:'clarify',status:'unclear'});
  assert.equal(s.stage,'explanation');assert.equal(s.evidence,null);
  s=transition(s,{type:'TRANSFER'});assert.throws(()=>transition(s,{type:'FINISH',reason:' '}));
  s=transition(s,{type:'FINISH',reason:'أبحث عن حل مناسب'});assert.equal(s.stage,'transfer_review');
  s=transition(s,{type:'TRANSFER_FEEDBACK',feedback:{status:'unavailable',strengths:[],additions:[]}});assert.equal(s.stage,'complete');
 }
});
test('misimported choice identifiers corrected without exchanging their feedback',()=>{
 const record=(topic,id)=>lessons.get(topic).records.find(r=>r.id===id).text;
 assert.match(record('amanah','choice.return'),/أعيد الفاتورة/);assert.match(record('amanah','comment.return'),/التزمت/);
 assert.match(record('amanah','choice.donate'),/أتبرع/);assert.match(record('amanah','comment.donate'),/صاحب المال/);
 assert.match(record('ghibah','choice.refuse'),/أقول بلطف/);assert.match(record('ghibah','comment.refuse'),/امتنعت/);
 assert.match(record('ghibah','choice.repeat'),/أضحك وأشارك/);assert.match(record('ghibah','comment.repeat'),/صحة الوصف/);
});
test('quotes must come from current reason and routes from the selected lesson',()=>{
 const prepared=prepareLesson(input,lessons);
 assert.deepEqual(prepared.normalize({route:'permission',evidence:'دون إذن'}),{route:'permission',evidence:'دون إذن'});
 for(const raw of [{route:'circulation',evidence:'دون إذن'},{route:'permission',evidence:'تعبنا في المشوار'},{route:'permission',evidence:'أعد المال'},{route:'permission',evidence:''},{route:'clarify',evidence:'إذن'},{route:'permission',evidence:'إذن',grade:10}])assert.equal(prepared.normalize(raw),null);
 for(const bad of [{...input,topicId:'../rifq'},{...input,adult:true},{...input,revised:{choice:'share',reason:'إذن'}}])assert.throws(()=>prepareLesson(bad,lessons));
});
test('Groq learning sends only revised choice/reason, requires no invented checkbox consents',async()=>{
 let request;const ai=await createLessonAIService({lessons,provider:'groq-evaluation',apiKey:'test-secret',fetchImpl:async(url,options)=>{request={url,...options};return reply({route:'permission',evidence:'دون إذن'});}});
 const result=await ai.analyze(input);assert.equal(result.status,'ok');assert.equal(result.route,'permission');
 const body=JSON.parse(request.body);assert.deepEqual(JSON.parse(body.messages[1].content),{choice:'return',reason:input.revised.reason});
 assert.ok(!body.messages[0].content.includes(input.initial.reason));assert.equal(body.tools,undefined);
 assert.deepEqual(body.response_format.json_schema.schema.properties.route.enum,Object.keys(lessons.get('amanah').topic.refs.followups));
 assert.equal(ai.config.scope,'learning');assert.ok(!JSON.stringify(ai.config).includes('test-secret'));
 assert.equal(body.max_completion_tokens,2048);assert.ok(body.response_format.json_schema.schema.properties.evidence.enum.includes('دون إذن'));
});
test('contact filters cover both reasons, Arabic/Persian digits and URLs without a call',async()=>{
 let calls=0;const ai=await createLessonAIService({lessons,provider:'groq-evaluation',apiKey:'test-secret',fetchImpl:async()=>{calls++;return reply({route:'general',evidence:''});}});
 for(const reason of ['test@example.invalid','رقم ٠٥٠٠٠٠٠٠٠٠','رقم ۰۵۰۰۰۰۰۰۰۰','https://example.invalid/'])for(const key of ['initial','revised']){
  const data=structuredClone(input);data[key].reason=reason;assert.equal((await ai.analyze(data)).status,'privacy');
 }
 assert.equal(calls,0);
});
test('unknown quotes, outages and quota do not fabricate personalized feedback or switch provider',async()=>{
 for(const [response,status] of [[reply({route:'permission',evidence:'invented'}),'invalid'],[new Response('',{status:503}),'unavailable'],[new Response('',{status:429}),'rate_limited']]){
  let calls=0;const ai=await createLessonAIService({lessons,provider:'groq-evaluation',apiKey:'test-secret',fetchImpl:async()=>{calls++;return response;}});
  const result=await ai.analyze(input);assert.equal(result.status,status);assert.equal(result.route,'general');assert.equal(result.evidence,'');assert.equal(calls,1);
 }
});
test('no key means no model call; cancelled request and one global budget apply across lessons',async()=>{
 const missing=await createLessonAIService({lessons,provider:'groq-evaluation',apiKey:'',fetchImpl:()=>{throw Error('must not call');}});
 assert.equal((await missing.analyze(input)).status,'not_configured');
 let calls=0;const ai=await createLessonAIService({lessons,provider:'groq-evaluation',apiKey:'test-secret',maxRequests:1,fetchImpl:async()=>{calls++;return reply({route:'general',evidence:''});}});
 const controller=new AbortController();controller.abort();assert.equal((await ai.analyze(input,{signal:controller.signal})).status,'unavailable');
 await ai.analyze(input);const other={topicId:'rifq',initial:{choice:'silence',reason:'لا أعرف'},revised:{choice:'silence',reason:'لا أعرف'}};
 assert.equal((await ai.analyze(other)).status,'budget_exhausted');assert.equal(calls,1);
});
test('editorial adoption cannot be mislabeled as completed scientific review in a release',()=>{
 const lesson=structuredClone(lessons.get('rifq'));for(const r of lesson.records){r.rights.status='cleared';if(r.approval)r.approval.hash=recordHash(r);}
 assert.ok(validateContent(lesson,{release:true}).some(x=>x.includes('Scientific review required')));
});
test('excerpt choices are bounded literal spans even with long text, spaces, emojis or punctuation',()=>{
 for(const reason of ['كلمة '.repeat(75),'أ'.repeat(400),'🙂'.repeat(150),'!.؟','الجملة الأولى، ثم جملة ثانية']){
  const data=structuredClone(input);data.revised.reason=reason;
  const prepared=prepareLesson(data,lessons),options=prepared.schema.properties.evidence.enum;
  assert.ok(options.includes(''));for(const span of options){assert.ok(span.length<=120);assert.ok(reason.trim().includes(span));}
 }
 const prepared=prepareLesson(input,lessons);assert.equal(prepared.normalize({route:'permission',evidence:'مال غيري'}),null);
});
