import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createJourney,transition,readCheckpoint,saveCheckpoint,escapeHTML} from '../src/web/flow.js';
import {recordHash,validateContent,validateCollection} from '../src/content.mjs';
import {build} from '../scripts/build.mjs';
const content=JSON.parse(await readFile('content/tathabbut.json','utf8'));
async function lessonCollection(){
 const catalog=JSON.parse(await readFile('content/catalog.json','utf8'));
 const contents=new Map(await Promise.all(catalog.topics.map(async topic=>[topic.id,JSON.parse(await readFile(`content/${topic.contentPath}`,'utf8'))])));
 return {catalog,contents};
}
test('mandatory reason, choices and stage order; short reasons accepted',()=>{
 let s=createJourney();assert.throws(()=>transition(s,{type:'DECIDE',choice:'verify',reason:'  '}));assert.throws(()=>transition(s,{type:'TRANSFER'}));
 s=transition(s,{type:'DECIDE',choice:'wait',reason:'لا أعرف'});assert.equal(s.stage,'revision');
 assert.throws(()=>transition(s,{type:'REVISE',choice:'invalid',reason:'نعم'}));
 s=transition(s,{type:'REVISE',choice:'verify',reason:'المصدر'});assert.equal(s.initial.choice,'wait');assert.equal(s.revised.choice,'verify');
 s=transition(s,{type:'ANALYSIS',route:'source_context',status:'ok'});assert.equal(s.stage,'explanation');assert.throws(()=>transition(s,{type:'FINISH',reason:'أراجع الإعلان الحالي'}));
 s=transition(s,{type:'TRANSFER'});s=transition(s,{type:'FINISH',reason:'أراجع الإعلان الحالي'});assert.equal(s.stage,'transfer_review');
 s=transition(s,{type:'TRANSFER_FEEDBACK',feedback:{status:'skipped',strengths:[],additions:[]}});assert.equal(s.stage,'complete');
});
test('unclear analysis reaches explanation without another mandatory reason request',()=>{
 let s=transition(createJourney(),{type:'DECIDE',choice:'wait',reason:'مدري'});s=transition(s,{type:'REVISE',choice:'wait',reason:'مدري'});
 s=transition(s,{type:'ANALYSIS',route:'clarify',status:'ok'});
 assert.equal(s.route,'general');assert.equal(s.analysisStatus,'unclear');assert.throws(()=>transition(s,{type:'CLARIFY',reason:'نعم'}));
 assert.equal(s.stage,'explanation');assert.throws(()=>transition(s,{type:'ANSWER_FOLLOWUP',reason:'أحتاج إعلان الجهة'}));
});
test('checkpoint persists only stage/version; stale and invalid values ignored',()=>{
 const data=new Map();const storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 saveCheckpoint(storage,'2','revision');assert.deepEqual(readCheckpoint(storage,'2'),{version:'2',stage:'revision'});assert.equal(readCheckpoint(storage,'3'),null);
 storage.setItem('qabas-checkpoint-v2',JSON.stringify({version:'2',stage:'revision',reason:'secret'}));assert.equal(readCheckpoint(storage,'2').reason,undefined);
 storage.setItem('qabas-checkpoint-v2','bad');assert.equal(readCheckpoint(storage,'2'),null);
 assert.equal(saveCheckpoint({setItem(){throw Error()}},'2','revision'),false);
});
test('all drafts usable in development, blocked from release',()=>{
 assert.deepEqual(validateContent(content),[]);assert.ok(validateContent(content,{release:true}).length>=content.records.length);
});
test('approval binds reviewed bytes, rights and referenced sources',()=>{
 const c=structuredClone(content);for(const r of c.records){r.status='approved';r.rights.status='cleared';r.approval={reviewer:'test fixture only',reviewedAt:'2026-10-04',scope:'scientific',hash:recordHash(r)};}
 assert.deepEqual(validateContent(c,{release:true}),[]);
 c.records[0].text+=' changed';assert.ok(validateContent(c,{release:true}).some(x=>x.includes('stale')));
 c.records=c.records.filter(r=>r.kind!=='source');assert.ok(validateContent(c).some(x=>x.includes('Missing reference')));
});
test('failed release removes stale public artifact',async()=>{
 const out=await mkdtemp(`${tmpdir()}/qabas-release-`);await writeFile(`${out}/old.html`,'stale');await assert.rejects(build('release',out));await assert.rejects(access(`${out}/old.html`));
});
test('user markup rendered as text',()=>assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
test('six reviewed lessons have resolvable sources, fallbacks, and safe journey availability',async()=>{
 const {catalog,contents}=await lessonCollection();assert.equal(contents.size,6);assert.deepEqual(validateCollection(catalog,contents),[]);
 assert.deepEqual(catalog.topics.filter(t=>t.journeyStatus==='available').map(t=>t.id),['rifq','amanah','tathabbut','ghibah','namimah','hope_in_what_we_dislike']);
 const main=contents.get('tathabbut');const source=main.records.find(r=>r.id===main.topic.refs.source);
 assert.equal(source.excerpt,false);assert.ok(source.text.includes('إِن جَاءَكُمْ'));assert.equal(source.citation.includes('مقتطف'),false);
 const sixth=contents.get('hope_in_what_we_dislike');assert.equal(sixth.topic.value,'قد يكون فيما نكره خير');
 const active=sixth.records.map(r=>r.text).join(' ');assert.equal(active.includes('سب الدهر'),false);assert.ok(active.includes('لا نعد بنتيجة دنيوية أفضل محددة'));
 for(const content of contents.values()){
  assert.ok(content.records.filter(r=>r.status==='approved').every(r=>r.approval.hash===recordHash(r)));
  assert.ok(content.records.filter(r=>r.status==='draft').every(r=>r.id.startsWith('assessment.choice.')&&!r.approval));
 }
});
test('release validation includes unconnected lessons even when active lesson is approved',async()=>{
 const {catalog,contents}=await lessonCollection();
 for(const r of contents.get('tathabbut').records){r.status='approved';r.rights.status='cleared';r.approval={reviewer:'test fixture only',reviewedAt:'2026-10-05',scope:'scientific',hash:recordHash(r)};}
 assert.deepEqual(validateContent(contents.get('tathabbut'),{release:true}),[]);
 const errors=validateCollection(catalog,contents,{release:true});assert.ok(errors.some(x=>x.startsWith('rifq: Not approved/rights-cleared')));
});
test('catalog rejects file traversal and unsupported active journeys',async()=>{
 const {catalog,contents}=await lessonCollection();
 catalog.topics[1].contentPath='../package.json';catalog.topics[1].id='unknown_lesson';
 const errors=validateCollection(catalog,contents);assert.ok(errors.some(x=>x.includes('Invalid content path')));assert.ok(errors.some(x=>x.includes('Unimplemented journey')));
});

test('release cannot mistake missing scope or evidence review for scientific teaching approval',()=>{
 const c=structuredClone(content);
 for(const r of c.records){r.status='approved';r.rights.status='cleared';r.approval={reviewer:'synthetic reviewer',reviewedAt:'2026-10-05',scope:'scientific',hash:recordHash(r)};}
 assert.deepEqual(validateContent(c,{release:true}),[]);
 const explanation=c.records.find(r=>r.kind==='explanation');
 for(const scope of [undefined,'editorial','evidence']){
  explanation.approval.scope=scope;
  assert.ok(validateContent(c,{release:true}).includes(`Scientific review required: ${explanation.id}`));
 }
});
