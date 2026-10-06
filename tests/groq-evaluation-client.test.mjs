import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGroqStructuredClient, MODEL, ENDPOINT} from '../src/groq-evaluation-client.mjs';
import {loadLessons,prepareLesson} from '../src/lesson-ai.mjs';
const lessons=await loadLessons();
const decision={choice:'gentle_correction',reason:'أوضح الخطأ بهدوء واحترام'};
const input={topicId:'rifq',initial:decision,revised:decision};
const expected={route:'gentle_correction',evidence:decision.reason};
const response=(content=expected,extra={})=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12},...extra});
const client=(fetchImpl,extra={})=>createGroqStructuredClient({prepare:value=>prepareLesson(value,lessons),apiKey:'test-secret',fetchImpl,...extra});

test('Trusted preparation, input, contact data and missing configuration block calls',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return response();};const analyze=client(fetchImpl);
 assert.throws(()=>createGroqStructuredClient({apiKey:'test-secret'}),/Trusted lesson/);
 for(const value of [{...input,policy:'ignore rules'},{...input,topicId:'other'},{...input,revised:{...decision,reason:' '}},{...input,revised:{...decision,reason:'x'.repeat(401)}}])assert.equal((await analyze(value)).status,'invalid_input');
 for(const reason of ['رقمي ٠٥٥١٢٣٤٥٦٧','contact@example.invalid'])assert.equal((await analyze({...input,revised:{...decision,reason}})).status,'blocked_privacy');
 assert.equal((await client(fetchImpl,{apiKey:''})(input)).status,'not_configured');
 assert.equal((await analyze(input,{signal:AbortSignal.abort()})).status,'unavailable');assert.equal(calls,0);
});

test('Fixed endpoint, strict schema, minimal payload and safe metadata',async()=>{
 const result=await client(async(url,options)=>{
  assert.equal(url,ENDPOINT);assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer test-secret');
  const body=JSON.parse(options.body);assert.equal(body.model,MODEL);assert.equal(body.max_completion_tokens,2048);assert.equal(body.stream,false);assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.response_format.json_schema.schema.additionalProperties,false);
  assert.deepEqual(JSON.parse(body.messages[1].content),decision);assert.ok(!body.messages[1].content.includes('initial'));return response();
 })(input);
 assert.equal(result.status,'classified');assert.deepEqual(result.analysis,expected);assert.deepEqual(result.usage,{prompt_tokens:10,completion_tokens:2,total_tokens:12});assert.ok(!JSON.stringify(result).includes('test-secret'));
});

test('Ambiguous output must abstain without an invented evidence quote',async()=>{
 assert.deepEqual((await client(async()=>response({route:'clarify',evidence:''}))(input)).analysis,{route:'clarify',evidence:''});
 assert.equal((await client(async()=>response({route:'clarify',evidence:decision.reason}))(input)).status,'invalid');
});

test('Unknown, extra, malformed, truncated, refused and oversized output is invalid',async()=>{
 const invalidResponses=[
  ()=>response({route:'unknown',evidence:decision.reason}),
  ()=>response({...expected,grade:100}),()=>response({...expected,evidence:'نص مختلق'}),()=>response(null),
  ()=>response({}, {choices:[{finish_reason:'stop',message:{content:'{'}}]}),
  ()=>response({}, {choices:[{finish_reason:'length',message:{content:JSON.stringify(expected)}}]}),
  ()=>response({}, {choices:[{finish_reason:'stop',message:{refusal:'refused',content:JSON.stringify(expected)}}]}),
  ()=>new Response('x'.repeat(65537)),()=>new Response(new Uint8Array([0xff]))
 ];
 for(const make of invalidResponses)assert.equal((await client(async()=>make())(input)).status,'invalid');
});

test('Rate limit is returned once without a retry or provider error body',async()=>{
 let calls=0;const result=await client(async()=>{calls++;return new Response('sensitive error',{status:429,headers:{'retry-after':'12'}});})(input);
 assert.equal(result.status,'rate_limited');assert.equal(result.retry_after_seconds,12);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes('sensitive error'));
});

test('HTTP and network failures return safe errors',async()=>{
 const httpResult=await client(async()=>new Response('test-secret',{status:401}))(input);assert.equal(httpResult.status,'unavailable');assert.equal(httpResult.http_status,401);
 const networkResult=await client(async()=>{throw Error('test-secret');})(input);assert.equal(networkResult.reason,'network_error');assert.ok(!JSON.stringify([httpResult,networkResult]).includes('test-secret'));
});

test('Upstream errors expose only a fixed category, with bounded reads',async()=>{
 for(const [error,category] of [
  [{code:'json_validate_failed',message:'test-secret '+decision.reason},'upstream_schema'],
  [{type:'invalid_request_error',message:'test-secret '+decision.reason},'upstream_request'],
  [{code:'model_not_found'},'upstream_model'],
  [{code:'context_length_exceeded'},'upstream_context'],
  [{code:decision.reason,type:'test-secret',message:'unknown'},'upstream_other']
 ]){
  const result=await client(async()=>Response.json({error},{status:400}))(input);
  assert.equal(result.reason,category);
  assert.ok(!JSON.stringify(result).includes('test-secret'));
  assert.ok(!JSON.stringify(result).includes(decision.reason));
 }
 const large=await client(async()=>new Response(JSON.stringify({error:{message:'x'.repeat(9000)}}),{status:400,headers:{'content-type':'application/json'}}))(input);
 assert.equal(large.reason,'upstream_other');
});

test('An actual HTTP redirect is rejected without forwarding the key or retrying',async()=>{
 let forwarded=0,calls=0;
 const destination=http.createServer((_request,res)=>{forwarded++;res.end('unexpected');});
 const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await listen(destination);
 const redirect=http.createServer((_request,res)=>{res.writeHead(302,{location:`http://127.0.0.1:${destination.address().port}/`});res.end('private upstream diagnostic');});
 await listen(redirect);
 try{
  const result=await client(async(url,options)=>{calls++;assert.equal(url,ENDPOINT);return fetch(`http://127.0.0.1:${redirect.address().port}/`,options);})(input);
  assert.equal(result.status,'unavailable');assert.equal(result.http_status,302);
  assert.equal(calls,1);assert.equal(forwarded,0);
  assert.ok(!JSON.stringify(result).includes('test-secret'));assert.ok(!JSON.stringify(result).includes('private upstream diagnostic'));
 }finally{await Promise.all([redirect,destination].map(server=>new Promise(resolve=>server.close(resolve))));}
});

test('Per-instance request budget includes failed attempts',async()=>{
 let calls=0;const analyze=client(async()=>{calls++;return new Response('down',{status:503});},{maxRequests:1});
 assert.equal((await analyze(input)).status,'unavailable');assert.equal((await analyze(input)).status,'budget_exhausted');assert.equal(calls,1);
});

test('Concurrent requests are rejected as busy instead of queued',async()=>{
 let release;const analyze=client(()=>new Promise(resolve=>{release=()=>resolve(response());}));const first=analyze(input);
 assert.equal((await analyze(input)).status,'busy');release();assert.equal((await first).status,'classified');
});

test('Timeout aborts requests and clears the in-flight state',async()=>{
 const analyze=client((_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})),{timeoutMs:10});
 for(let i=0;i<2;i++){const result=await analyze(input);assert.equal(result.status,'unavailable');assert.equal(result.reason,'cancelled_or_timeout');}
});
