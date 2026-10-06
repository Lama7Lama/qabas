export const STAGES=['decision','revision','followup','explanation','transfer','transfer_review','complete'];
export const CHOICES=['share','verify','wait'];
export const ROUTES=['circulation','source_context','caution','clarify','general'];
export const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validReason(value){return typeof value==='string' && value.trim().length>0 && value.trim().length<=400;}
export const FEEDBACK_STATUSES=['ok','unclear','unverified','outside','unavailable','invalid','privacy','not_configured','rate_limited','budget_exhausted','busy','skipped'];
export function validFeedback(data,criteria,answer){
  if(!data||!FEEDBACK_STATUSES.includes(data.status)||!Array.isArray(data.strengths)||!Array.isArray(data.additions))return false;
  if(Object.keys(data).sort().join(',')!=='additions,status,strengths')return false;
  if(data.status!=='ok')return data.strengths.length===0&&data.additions.length===0;
  const used=new Set();
  for(const [items,addition] of [[data.strengths,false],[data.additions,true]])for(const item of items){
    if(!item||!criteria.includes(item.criterion)||used.has(item.criterion)||typeof item.evidence!=='string')return false;
    if(Object.keys(item).sort().join(',')!==(addition?'criterion,evidence,kind':'criterion,evidence'))return false;
    used.add(item.criterion);
    if(addition&&!['opposed','not_shown'].includes(item.kind))return false;
    if(addition&&item.kind==='not_shown'){if(item.evidence!=='')return false;}
    else if(!item.evidence.trim()||item.evidence.length>120||!answer.includes(item.evidence))return false;
  }
  return data.strengths.length>0||data.additions.some(item=>item.kind==='opposed');
}
// A summary describes validated, published criteria, never the model's free text.
// Missing detail is distinct from a confirmed contradiction. Unverified criteria
// cannot produce an overall positive verdict.
export function feedbackVerdict(data,criteria,answer){
  if(!validFeedback(data,criteria,answer)||data.status!=='ok')return null;
  if(data.additions.some(item=>item.kind==='opposed'))return 'needs_correction';
  if(data.strengths.length+data.additions.length<criteria.length)return 'partial';
  return data.additions.length?'needs_addition':'appropriate';
}
export function createJourney(contract={}){return {stage:'decision',initial:null,revised:null,route:null,transferAnswer:null,analysisStatus:null,evidence:null,feedback:null,correctionCount:0,transferRevisionCount:0,choices:contract.choices||CHOICES,routes:contract.routes||ROUTES};}
export function transition(state,event){
  const s=structuredClone(state);
  if(event.type==='DECIDE' && s.stage==='decision' && s.choices.includes(event.choice) && validReason(event.reason)) {
    s.initial={choice:event.choice,reason:event.reason.trim()};s.stage='revision';
  } else if(event.type==='REVISE' && s.stage==='revision' && s.choices.includes(event.choice) && validReason(event.reason)) {
    s.revised={choice:event.choice,reason:event.reason.trim()};s.stage='followup';
  } else if(event.type==='ANALYSIS' && s.stage==='followup' && !s.route && s.routes.includes(event.route)) {
    // A low-confidence classification must not request the same reason a third time.
    s.route=event.route==='clarify'?'general':event.route;
    s.analysisStatus=event.route==='clarify'&&event.status==='ok'?'unclear':event.status;
    s.evidence=event.status==='ok'&&typeof event.evidence==='string'&&event.evidence.trim()&&event.evidence.length<=120&&s.revised.reason.includes(event.evidence)?event.evidence:null;
    s.stage='explanation';
  } else if(event.type==='TRANSFER' && s.stage==='explanation') s.stage='transfer';
  else if(event.type==='CORRECT_REASON' && s.stage==='explanation' && s.correctionCount<1 && validReason(event.reason)){
    s.revised.reason=event.reason.trim();s.correctionCount++;s.route=null;s.evidence=null;s.analysisStatus=null;s.stage='followup';
  }
  else if(event.type==='FINISH' && s.stage==='transfer' && validReason(event.reason)){s.transferAnswer=event.reason.trim();s.stage='transfer_review';}
  else if(event.type==='TRANSFER_FEEDBACK' && s.stage==='transfer_review' && FEEDBACK_STATUSES.includes(event.feedback?.status)) {s.feedback=event.feedback;s.stage='complete';}
  else if(event.type==='REVIEW_TRANSFER' && s.stage==='complete' && s.transferRevisionCount<1){s.transferRevisionCount++;s.stage='transfer';s.feedback=null;}
  else throw Error('Invalid journey transition');
  return s;
}
// Reasons and decisions stay in memory. A stored checkpoint cannot reconstruct them.
export function readCheckpoint(storage,version){
  try{const d=JSON.parse(storage.getItem('qabas-checkpoint-v2'));return d?.version===version && STAGES.includes(d.stage)?{version,stage:d.stage}:null;}catch{return null;}
}
export function saveCheckpoint(storage,version,stage){try{storage.setItem('qabas-checkpoint-v2',JSON.stringify({version,stage}));return true;}catch{return false;}}
