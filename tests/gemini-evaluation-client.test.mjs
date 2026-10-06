import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiEvaluationClient, MODEL, ENDPOINT} from '../src/gemini-evaluation-client.mjs';
const input = {answer: 'أراجع المصدر'};
const schema = {type:'object',properties:{route:{type:'string',enum:['verify']}},required:['route'],additionalProperties:false};
const prepare = payload => ({payload, policy:'Frozen test policy', schema, maxCompletionTokens:2048,
  normalize: x => x?.route === 'verify' && Object.keys(x).length === 1 ? x : null});
const response = (content = '{"route":"verify"}', extra = {}) => Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:content}]}}], ...extra});
const client = (fetchImpl, extra={}) => createGeminiEvaluationClient({prepare,apiKey:'test-secret',fetchImpl,...extra});
const opts = {synthetic:true};
test('Gemini comparison sends the same trusted policy, payload and schema, without exposing the key', async () => {
  const analyze = client(async (url, options) => {
    assert.equal(url, ENDPOINT);
    assert.equal(url.includes('test-secret'), false);
    assert.equal(options.headers['x-goog-api-key'], 'test-secret');
    assert.equal(options.redirect, 'error');
    const body=JSON.parse(options.body);
    assert.deepEqual(body.systemInstruction,{parts:[{text:'Frozen test policy'}]});
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text),input);
    assert.deepEqual(body.generationConfig.responseFormat.text,{mimeType:'APPLICATION_JSON',schema});
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel,'LOW');
    assert.equal(body.generationConfig.maxOutputTokens,2048);
    return response();
  });
  const result=await analyze(input,opts);
  assert.equal(result.status,'classified');
  assert.equal(result.model,MODEL);
  assert.equal(JSON.stringify(result).includes('test-secret'),false);
});
test('Gemini evaluation is synthetic only and blocks configuration, privacy and cancelled requests before fetch',async()=>{
  let calls=0; const fetchImpl=async()=>{calls++;return response();};
  const analyze=client(fetchImpl);
  assert.equal((await analyze(input)).status,'blocked_scope');
  for(const answer of ['contact@example.org','رقمي ٠٥٥١٢٣٤٥٦٧','https://example.org'])assert.equal((await analyze({answer},opts)).status,'blocked_privacy');
  assert.equal((await client(fetchImpl,{apiKey:''})(input,opts)).status,'not_configured');
  assert.equal((await analyze(input,{...opts,signal:AbortSignal.abort()})).status,'unavailable');
  assert.equal(calls,0);
});
test('Gemini rejects truncated, blocked, oversized, malformed and out-of-contract replies',async()=>{
  const responses=[
    ()=>response('{'),()=>response('{"route":"other"}'),
    ()=>response('{}',{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]}),
    ()=>response('{}',{promptFeedback:{blockReason:'SAFETY'}}),
    ()=>new Response('x'.repeat(65537))
  ];
  for(const make of responses)assert.equal((await client(async()=>make())(input,opts)).status,'invalid');
});
test('Gemini quota and HTTP failures preserve only safe metadata, never retry, and consume the budget',async()=>{
  let calls=0;
  const analyze=client(async()=>{calls++;return Response.json({error:{message:'test-secret',details:[
    {'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'12s'},
    {'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaMetric:'generate_content_free_tier_requests',quotaValue:'0',sensitive:'test-secret'}]}
  ]}},{status:429});},{maxRequests:1});
  const result=await analyze(input,opts);
  assert.equal(result.status,'rate_limited');assert.equal(result.retry_after_seconds,12);
  assert.equal(result.quota[0].quotaValue,'0');assert.equal(JSON.stringify(result).includes('test-secret'),false);
  assert.equal((await analyze(input,opts)).status,'budget_exhausted');assert.equal(calls,1);
  const failed=await client(async()=>new Response('test-secret',{status:401}))(input,opts);
  assert.equal(failed.http_status,401);assert.equal(JSON.stringify(failed).includes('test-secret'),false);
});
test('Gemini concurrent calls and timeout do not leave a stuck client',async()=>{
  let release;
  const analyze=client(()=>new Promise(resolve=>{release=()=>resolve(response());}));
  const first=analyze(input,opts);assert.equal((await analyze(input,opts)).status,'busy');release();
  assert.equal((await first).status,'classified');
  const timed=client((_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('test-secret')))),{timeoutMs:10});
  for(let i=0;i<2;i++)assert.equal((await timed(input,opts)).reason,'cancelled_or_timeout');
});
