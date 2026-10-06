import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadLessons} from '../src/lesson-ai.mjs';
import {validateContent} from '../src/content.mjs';
const lessons=await loadLessons();
test('choice guidance covers all choices, stays separate from scientific approval, and allows contextual silence',()=>{
 for(const lesson of lessons.values()){
  assert.deepEqual(validateContent(lesson),[]);
  const map=new Map(lesson.records.map(r=>[r.id,r]));
  const refs=lesson.topic.refs;
  assert.deepEqual(Object.keys(refs.choiceAssessments).sort(),refs.choices.map(id=>map.get(id).value).sort());
  for(const id of Object.values(refs.choiceAssessments)){
   assert.equal(map.get(id).status,'draft');assert.equal(map.get(id).approval,undefined);
   assert.ok(validateContent(lesson,{release:true}).some(e=>e.includes(id)));
  }
 }
 const rifq=lessons.get('rifq');
 assert.equal(rifq.records.find(r=>r.id===rifq.topic.refs.choiceAssessments.silence).value,'contextual');
});
test('invalid or incomplete choice guidance fails content validation',()=>{
 const c=structuredClone(lessons.get('rifq'));
 delete c.topic.refs.choiceAssessments.silence;
 assert.ok(validateContent(c).includes('Missing choice assessment'));
 const invalid=structuredClone(lessons.get('rifq'));
 invalid.records.find(r=>r.id===invalid.topic.refs.choiceAssessments.silence).value='wrong_person';
 assert.ok(validateContent(invalid).some(e=>e.startsWith('Invalid choice assessment')));
});
test('new assessment labels preserve every existing record including reviewed sources',async()=>{
 const baseline=JSON.parse(await readFile(new URL('../docs/evaluations/assessment-content-baseline-2026-10-05.json',import.meta.url),'utf8'));
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 for(const [topicId,hashes] of Object.entries(baseline.recordsSha256)){
  const map=new Map(lessons.get(topicId).records.map(r=>[r.id,r]));
  for(const [id,hash] of Object.entries(hashes))assert.equal(createHash('sha256').update(JSON.stringify(canonical(map.get(id)))).digest('hex'),hash,`${topicId}:${id}`);
 }
});
