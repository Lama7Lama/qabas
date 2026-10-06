import {createHash} from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
export function recordHash(record) {
  const {status, approval, ...body} = record;
  return createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
}
export function validateContent(content, {release=false}={}) {
  const errors=[];
  if(content.schemaVersion!==1 || !content.topic?.refs || !Array.isArray(content.records)) return ['Invalid content schema'];
  const map=new Map();
  for(const record of content.records){
    if(!record.id || map.has(record.id)) errors.push(`Duplicate or missing id: ${record.id}`);
    map.set(record.id,record);
    if(!record.text?.trim() || !record.version || !['draft','approved'].includes(record.status)) errors.push(`Invalid record: ${record.id}`);
    if(record.kind==='source' && !/^https:\/\//.test(record.url||'')) errors.push(`Invalid source URL: ${record.id}`);
    if(record.status==='approved') {
      const a=record.approval;
      if(!a?.reviewer?.trim() || !a?.reviewedAt || !Number.isFinite(Date.parse(a.reviewedAt)) || a.hash!==recordHash(record)) errors.push(`Missing or stale approval: ${record.id}`);
    }
    if(release && (record.status!=='approved' || record.rights?.status!=='cleared')) errors.push(`Not approved/rights-cleared: ${record.id}`);
    if(release && record.status==='approved' && !['editorial','evidence','scientific'].includes(record.approval?.scope))errors.push(`Explicit review scope required: ${record.id}`);
    if(release && record.status==='approved' && record.approval?.scope!=='scientific' && ['explanation','followup','example','rubric'].includes(record.kind)) errors.push(`Scientific review required: ${record.id}`);
  }
  const refs=(v)=>typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(refs):Object.values(v||{}).flatMap(refs);
  for(const id of [...refs(content.topic.refs),...content.records.flatMap(r=>r.sourceIds||[])]) if(!map.has(id)) errors.push(`Missing reference: ${id}`);
  const choices=content.topic.refs.choices, followups=content.topic.refs.followups;
  if(!Array.isArray(choices)||choices.length!==3||!followups||typeof followups!=='object') return [...errors,'Invalid journey contract'];
  const values=choices.map(id=>map.get(id)?.value);
  if(content.topic.id==='tathabbut') {
    if(JSON.stringify(values)!==JSON.stringify(['share','verify','wait'])) errors.push('Invalid choice contract');
    if(JSON.stringify(Object.keys(followups).sort())!==JSON.stringify(['caution','circulation','clarify','general','source_context'])) errors.push('Invalid followup contract');
  } else {
    if(values.some(v=>typeof v!=='string'||!v)||new Set(values).size!==3) errors.push('Invalid lesson choices');
    if(!followups.clarify||!followups.general) errors.push('Missing fallback followups');
  }
  if(Object.keys(content.topic.refs.comments||{}).sort().join(',')!==[...values].sort().join(',')) errors.push('Missing choice feedback');
  if(content.topic.refs.choiceAssessments){
    const assessments=content.topic.refs.choiceAssessments;
    if(Object.keys(assessments).sort().join(',')!==[...values].sort().join(','))errors.push('Missing choice assessment');
    for(const id of Object.values(assessments)){
      const record=map.get(id);
      if(record?.kind!=='rubric'||!['appropriate','needs_correction','needs_addition','contextual'].includes(record.value))errors.push(`Invalid choice assessment: ${id}`);
    }
  }
  if(content.topic.refs.understandings){
    const routes=Object.keys(followups).filter(id=>!['general','clarify'].includes(id)).sort();
    if(Object.keys(content.topic.refs.understandings).sort().join(',')!==routes.join(','))errors.push('Missing reason understandings');
  }
  if(content.topic.refs.transferFeedback){
    const feedback=content.topic.refs.transferFeedback;
    if(Object.keys(feedback.criteria||{}).length!==3||!feedback.clarification)errors.push('Invalid transfer feedback contract');
    for(const criterion of Object.values(feedback.criteria||{}))if(Object.keys(criterion||{}).sort().join(',')!=='addition,concern,definition,question,strength')errors.push('Invalid transfer criterion');
  }
  return errors;
}

// Validation covers the whole catalog, including lessons not yet connected to AI.
export function validateCollection(catalog, contents, {release=false}={}) {
  if(catalog?.schemaVersion!==1||!Array.isArray(catalog.topics)||!catalog.topics.length) return ['Invalid topic catalog'];
  const errors=[], ids=new Set(), paths=new Set();
  if(catalog.about){
    const about=catalog.about,allowed=new Set(['https://dorar.net/hadith','https://quranpedia.net/','https://shamela.ws/']);
    if(['aiRole','aiReview','aiLimits','privacy','sourcesBody','referencesLabel'].some(k=>typeof about[k]!=='string'||!about[k].trim())||!Array.isArray(about.references)||about.references.length!==3||new Set(about.references.map(r=>r?.url)).size!==3||about.references.some(r=>typeof r?.label!=='string'||!r.label.trim()||!allowed.has(r.url)))errors.push('Invalid about copy or references');
  }
  if(catalog.humanSupport){
    const s=catalog.humanSupport;
    if(['title','body','label'].some(k=>typeof s[k]!=='string'||!s[k].trim())||s.url!=='https://alifta.gov.sa/')errors.push('Invalid human support reference');
  }
  for(const topic of catalog.topics) {
    if(!/^[a-z_]+$/.test(topic.id||'')||ids.has(topic.id)||typeof topic.title!=='string'||!topic.title.trim()) errors.push('Invalid or duplicate catalog topic');
    ids.add(topic.id);
    if(!/^(?:lessons\/)?[a-z_]+\.json$/.test(topic.contentPath||'')||paths.has(topic.contentPath)) errors.push(`Invalid content path: ${topic.id}`);
    paths.add(topic.contentPath);
    if(!['available','not_connected'].includes(topic.journeyStatus)||!['rifq','amanah','tathabbut','ghibah','namimah','hope_in_what_we_dislike'].includes(topic.id)) errors.push(`Unimplemented journey: ${topic.id}`);
    const content=contents.get(topic.id);
    if(!content||content.topic?.id!==topic.id) {errors.push(`Missing catalog content: ${topic.id}`);continue;}
    errors.push(...validateContent(content,{release}).map(error=>`${topic.id}: ${error}`));
  }
  if(!ids.has('tathabbut')||contents.size!==ids.size) errors.push('Catalog/content mismatch');
  return errors;
}
