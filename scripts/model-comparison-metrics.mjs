export function scoreFixture(fixture, result) {
  const operational = fixture.task === 'reason' ? ['ok','unclear','general'].includes(result.status) : ['ok','unclear','unverified','outside'].includes(result.status);
  const actual = fixture.task === 'reason' ? result.route : Object.fromEntries([
    ...(result.strengths || []).map(x => [x.criterion,'supported']),
    ...(result.additions || []).map(x => [x.criterion,x.kind])
  ]);
  const expected = fixture.expected || {};
  const items = [...(result.strengths || []),...(result.additions || [])];
  return {
    operational, actual,
    match: operational ? fixture.task === 'reason' ? result.route === fixture.expectedRoute : result.status === fixture.expectedStatus && Object.entries(expected).every(([id,state]) => actual[id] === state) && Object.keys(actual).every(id => Object.hasOwn(expected,id)) : null,
    falsePraise: fixture.task === 'transfer' ? Object.entries(actual).filter(([id,state]) => state === 'supported' && expected[id] !== 'supported').map(([id]) => id) : [],
    falseOpposition: fixture.task === 'transfer' ? Object.entries(actual).filter(([id,state]) => state === 'opposed' && expected[id] !== 'opposed').map(([id]) => id) : [],
    overAbstention: operational && fixture.task === 'transfer' && fixture.expectedStatus === 'ok' && ['unclear','unverified','outside'].includes(result.status),
    quoteValid: fixture.task === 'reason' ? result.evidence === '' || typeof result.evidence === 'string' && fixture.reason.includes(result.evidence) : items.every(x => !x.evidence || fixture.answer.includes(x.evidence))
  };
}
const median = xs => { const s=[...xs].sort((a,b)=>a-b); return s.length ? s.length%2 ? s[(s.length-1)/2] : (s[s.length/2-1]+s[s.length/2])/2 : null; };
export function summarize(rows, provider) {
  const observed=rows.filter(r=>r.results[provider]), valid=observed.filter(r=>r.results[provider].score.operational);
  return {visited:observed.length,operational:valid.length,matches:valid.filter(r=>r.results[provider].score.match).length,
    falsePraiseCases:valid.filter(r=>r.results[provider].score.falsePraise.length).length,
    falseOppositionCases:valid.filter(r=>r.results[provider].score.falseOpposition.length).length,
    overAbstentions:valid.filter(r=>r.results[provider].score.overAbstention).length,
    tasks:Object.fromEntries(['reason','transfer'].map(task=>{const group=valid.filter(r=>r.task===task);return [task,{operational:group.length,matches:group.filter(r=>r.results[provider].score.match).length,medianLatencyMs:median(group.map(r=>r.results[provider].latencyMs))}];})),
    partitions:Object.fromEntries(['known_regression','new_before_comparison'].map(partition=>{const group=valid.filter(r=>r.partition===partition);return [partition,{operational:group.length,matches:group.filter(r=>r.results[provider].score.match).length}];}))};
}
