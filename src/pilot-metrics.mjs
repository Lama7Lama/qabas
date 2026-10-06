export const PILOT_HEADERS=['participant_id','variant','adult_confirmed','consent_recorded','pre_source','pre_year','pre_deadline','post_source','post_year','post_deadline','completed','duration_seconds','clarity_1_5','help_requests'];

// Only anonymous structured observations are accepted. No answer text or demographics.
export function parsePilotCSV(input){
  if(typeof input!=='string'||input.length>65536)throw Error('Invalid pilot file size');
  const text=input.replace(/^\uFEFF/,'');
  const rows=[];let row=[],field='',quoted=false,closed=false;
  const cell=()=>{row.push(field);field='';closed=false;};
  const line=()=>{cell();if(row.some(v=>v!==''))rows.push(row);row=[];};
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=ch;continue;}
    if(ch==='"'){if(field||closed)throw Error('Invalid CSV quoting');quoted=true;continue;}
    if(ch===','){cell();continue;}
    if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;line();continue;}
    if(closed)throw Error('Invalid CSV quoting');field+=ch;
  }
  if(quoted)throw Error('Unclosed CSV field');
  if(field||row.length||closed)line();
  if(!rows.length||rows[0].join(',')!==PILOT_HEADERS.join(','))throw Error('Use the supplied pilot headers');
  return rows.slice(1).map(values=>{
    if(values.length!==PILOT_HEADERS.length)throw Error('Invalid column count');
    return Object.fromEntries(PILOT_HEADERS.map((key,i)=>[key,values[i]]));
  });
}
function number(value,min,max,optional=true){
  if(value===''&&optional)return null;
  if(!/^\d+$/.test(value))throw Error('Pilot observations must use whole numbers');
  const n=Number(value);if(n<min||n>max)throw Error('Pilot observation is outside the allowed range');return n;
}
const mean=values=>values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*100)/100:null;
const summarizeGroup=rows=>{
  const paired=rows.filter(r=>r.pre.every(n=>n!==null)&&r.post.every(n=>n!==null));
  const scores=paired.map(r=>({pre:r.pre.reduce((a,b)=>a+b),post:r.post.reduce((a,b)=>a+b)}));
  const durations=rows.flatMap(r=>r.duration===null?[]:[r.duration]);
  const clarity=rows.flatMap(r=>r.clarity===null?[]:[r.clarity]);
  return {participants:rows.length,completed:rows.filter(r=>r.completed).length,completionRate:rows.length?rows.filter(r=>r.completed).length/rows.length:null,pairedScores:paired.length,preMeanOutOf3:mean(scores.map(s=>s.pre)),postMeanOutOf3:mean(scores.map(s=>s.post)),meanGainOutOf3:mean(scores.map(s=>s.post-s.pre)),improved: scores.filter(s=>s.post>s.pre).length,unchanged:scores.filter(s=>s.post===s.pre).length,declined:scores.filter(s=>s.post<s.pre).length,durationCount:durations.length,durationMeanSeconds:mean(durations),clarityCount:clarity.length,clarityMeanOutOf5:mean(clarity)};
};
export function summarizePilot(observations){
  if(!Array.isArray(observations)||observations.length>100)throw Error('Invalid observation count');
  const ids=new Set();
  const rows=observations.map(r=>{
    if(Object.keys(r).length!==PILOT_HEADERS.length||PILOT_HEADERS.some(h=>typeof r[h]!=='string'))throw Error('Use only the supplied observation fields');
    if(!/^P\d{3}$/.test(r.participant_id)||ids.has(r.participant_id))throw Error('Use unique anonymous P001 identifiers');ids.add(r.participant_id);
    if(!['adaptive','fixed'].includes(r.variant)||r.adult_confirmed!=='yes'||r.consent_recorded!=='yes'||!['yes','no'].includes(r.completed))throw Error('Confirm adult consent and a valid variant and completion status');
    const pre=['pre_source','pre_year','pre_deadline'].map(h=>number(r[h],0,1));
    const post=['post_source','post_year','post_deadline'].map(h=>number(r[h],0,1));
    return {variant:r.variant,pre,post,completed:r.completed==='yes',duration:number(r.duration_seconds,1,7200),clarity:number(r.clarity_1_5,1,5),help:number(r.help_requests,0,100)};
  });
  return {status:rows.length?'pilot_observations':'not_run',rubricStatus:'project_draft_pending_specialist_review',overall:summarizeGroup(rows),variants:Object.fromEntries(['adaptive','fixed'].map(v=>[v,summarizeGroup(rows.filter(r=>r.variant===v))])),limitations:'A small convenience pilot with project-authored criteria. Missing scores are excluded from paired means, never treated as zero. Descriptive observations do not establish causality, model accuracy, or religious characteristics.'};
}
