import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreFixture,summarize} from '../scripts/model-comparison-metrics.mjs';
const fixture={task:'transfer',answer:'نص مصطنع',expectedStatus:'ok',expected:{a:'opposed',b:'not_shown',c:'supported'}};
test('Comparison distinguishes false praise, false correction and missing detail',()=>{
  const score=scoreFixture(fixture,{status:'ok',strengths:[{criterion:'a',evidence:'نص'}],additions:[{criterion:'b',kind:'opposed',evidence:'مصطنع'}]});
  assert.deepEqual(score.falsePraise,['a']);assert.deepEqual(score.falseOpposition,['b']);assert.equal(score.match,false);assert.equal(score.quoteValid,true);
  assert.equal(scoreFixture(fixture,{status:'unverified'}).overAbstention,true);
});
test('Provider outage cannot be counted as a semantic match or a zero-latency success',()=>{
  const score=scoreFixture(fixture,{status:'rate_limited'});assert.equal(score.match,null);assert.equal(score.operational,false);
  const stats=summarize([{task:'transfer',partition:'new_before_comparison',results:{gemini:{score,latencyMs:1}}}],'gemini');
  assert.equal(stats.visited,1);assert.equal(stats.operational,0);assert.equal(stats.tasks.transfer.medianLatencyMs,null);
});
test('A literal quote alone cannot make a mismatched route or incomplete rubric pass',()=>{
  assert.equal(scoreFixture({task:'reason',reason:'أراجع المصدر',expectedRoute:'source_context'},{status:'ok',route:'circulation',evidence:'المصدر'}).match,false);
  assert.equal(scoreFixture(fixture,{status:'ok',strengths:[{criterion:'c',evidence:'نص'}],additions:[{criterion:'a',kind:'opposed',evidence:'مصطنع'}]}).match,false);
});
