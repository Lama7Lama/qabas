import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLessons} from '../src/lesson-ai.mjs';
import {createPagesHandler,readPagesJSON} from '../src/cloudflare-pages.mjs';

const lessons=await loadLessons(),origin='https://qabas.example.invalid';
const password='synthetic-review-password-32-chars',key='synthetic-model-secret';
const auth='Basic '+Buffer.from('qabas:'+password).toString('base64');
const env={QABAS_PUBLIC_ORIGIN:origin,QABAS_REVIEW_PASSWORD:password,GROQ_API_KEY:key,ASSETS:{fetch:async()=>new Response('<html>قبس</html>',{headers:{'Content-Type':'text/html'}})}};
const input={topicId:'amanah',initial:{choice:'keep',reason:'لا أعرف'},revised:{choice:'return',reason:'لا أتصرف في مال غيري، دون إذن'}};
const request=(path='/',{method='GET',headers={},body,...rest}={})=>new Request(origin+path,{method,headers:{Authorization:auth,...(method==='POST'?{Origin:origin,'Content-Type':'application/json','X-Qabas-Request':'1'}:{}),...headers},...(body!==undefined?{body}:{}),...rest});
const handler=(options={})=>createPagesHandler({lessons,assetPaths:new Set(['/','/index.html','/app.js']),...options});
const model=raw=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}));

test('Pages protects assets and APIs, does not disclose secrets, and fails closed without setup',async()=>{
  const handle=handler();
  for(const path of ['/','/app.js','/api/config']){
    const r=await handle(request(path,{headers:{Authorization:''}}),env);assert.equal(r.status,401);
    assert.ok(r.headers.get('www-authenticate').startsWith('Basic'));assert.ok(!(await r.text()).includes(password));
  }
  for(const value of ['', 'short'])assert.equal((await handle(request(),{...env,QABAS_REVIEW_PASSWORD:value})).status,503);
  for(const value of ['',origin+'/path','http://qabas.example.invalid'])assert.equal((await handle(request(),{...env,QABAS_PUBLIC_ORIGIN:value})).status,503);
  assert.equal((await handle(request(),{...env,QABAS_REVIEW_PASSWORD:undefined})).status,503);
  const config=await handle(request('/api/config'),env),text=await config.text();assert.equal(config.status,200);
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(),['configured','model','provider','scope']);
  assert.ok(!text.includes(key)&&!text.includes(password));
  assert.equal((await handle(request('/healthz',{headers:{Authorization:''}}),env)).status,200);
  assert.equal((await handle(request('/healthz'),{...env,GROQ_API_KEY:''})).status,503);
});
test('Pages verifies HTTPS, the configured origin, navigation and API request headers',async()=>{
  const handle=handler();
  assert.equal((await handle(new Request('http://qabas.example.invalid/api/config'),env)).status,403);
  assert.equal((await handle(new Request('https://attacker.example.invalid/api/config'),env)).status,403);
  const h={'Sec-Fetch-Site':'cross-site'};
  assert.equal((await handle(request('/api/config',{headers:h}),env)).status,403);
  assert.equal((await handle(request('/',{headers:{...h,'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'}}),env)).status,200);
  for(const headers of [{Origin:'https://attacker.example.invalid'},{'X-Qabas-Request':''},{'Content-Type':'text/plain'}])assert.equal((await handle(request('/api/reflect',{method:'POST',body:JSON.stringify(input),headers}),env)).status,403);
});
test('Pages serves only the build asset list and strips credentials from asset fetching',async()=>{
  let forwarded;const handle=handler();
  const r=await handle(request('/',{headers:{Cookie:'private-cookie'}}),{...env,ASSETS:{fetch:async req=>{forwarded=req;return new Response('قبس');}}});
  assert.equal(r.status,200);assert.equal(forwarded.headers.get('authorization'),null);assert.equal(forwarded.headers.get('cookie'),null);
  for(const path of ['/.env.local','/.dev.vars','/.git/config','/src/lesson-ai.mjs','/docs/report.md','/missing.js','/%2eenv.local','/_worker.js','/api/missing'])assert.equal((await handle(request(path),env)).status,404);
  assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.ok(r.headers.get('strict-transport-security'));assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  const head=await handle(request('/app.js',{method:'HEAD'}),env);assert.equal(await head.text(),'');
});
test('Pages keeps reason classification grounded and does not send the initial reason',async()=>{
  let sent;
  const handle=handler({fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bearer '+key);return model({route:'permission',evidence:'دون إذن'});}});
  const r=await handle(request('/api/reflect',{method:'POST',body:JSON.stringify(input)}),env);
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{route:'permission',status:'ok',evidence:'دون إذن'});
  assert.deepEqual(JSON.parse(sent.messages[1].content),{choice:'return',reason:input.revised.reason});
});
test('Pages rejects malformed or personal inputs before a model call and bounds body bytes',async()=>{
  let calls=0;const handle=handler({fetchImpl:async()=>{calls++;throw Error();}});
  for(const body of ['{','{}',JSON.stringify({...input,unexpected:true})])assert.equal((await handle(request('/api/reflect',{method:'POST',body}),env)).status,400);
  assert.equal((await handle(request('/api/reflect',{method:'POST',body:'x'.repeat(8193)}),env)).status,413);
  const privateInput=structuredClone(input);privateInput.revised.reason='رقم ٠٥٠٠٠٠٠٠٠٠';
  const r=await handle(request('/api/reflect',{method:'POST',body:JSON.stringify(privateInput)}),env);assert.equal((await r.json()).status,'privacy');assert.equal(calls,0);
  const unconfigured=await handle(request('/api/reflect',{method:'POST',body:JSON.stringify(input)}),{...env,GROQ_API_KEY:''});assert.equal((await unconfigured.json()).status,'not_configured');assert.equal(calls,0);
});
test('Pages decodes split Arabic bytes, rejects invalid UTF-8, and cancels stalled request streams',async()=>{
  const bytes=new TextEncoder().encode('{"text":"عربي"}');let i=0;
  const stream=new ReadableStream({pull(controller){if(i<bytes.length)controller.enqueue(bytes.slice(i,++i));else controller.close();}});
  assert.deepEqual(await readPagesJSON(new Request(origin,{method:'POST',body:stream,duplex:'half'})),{text:'عربي'});
  await assert.rejects(()=>readPagesJSON(new Request(origin,{method:'POST',body:new Uint8Array([0xff])})),TypeError);
  let cancelled=false;const stalled=new ReadableStream({cancel(){cancelled=true;}});
  await assert.rejects(()=>readPagesJSON(new Request(origin,{method:'POST',body:stalled,duplex:'half'}),{timeoutMs:5}),error=>error.statusCode===408);assert.equal(cancelled,true);
});
test('Pages transfer uses two readings and publishes only their agreement',async()=>{
  const answer='لن أهين أخي، وأستخدم الهاتف لإكمال العمل، وسأتفق معه على وقت لاستخدام الجهاز';let calls=0;
  const handle=handler({fetchImpl:async(url,options)=>{
    calls++;const user=JSON.parse(JSON.parse(options.body).messages[1].content),find=text=>Object.keys(user.excerpts).find(k=>user.excerpts[k]===text);
    return model({mode:'feedback',checks:{respect:{state:'supported',evidence:find('لن أهين أخي')},practical:{state:'supported',evidence:find('وأستخدم الهاتف لإكمال العمل')},agreement:{state:'supported',evidence:find('وسأتفق معه على وقت لاستخدام الجهاز')}}});
  }});
  const r=await handle(request('/api/transfer-feedback',{method:'POST',body:JSON.stringify({topicId:'rifq',answer})}),env);
  const data=await r.json();assert.equal(r.status,200);assert.equal(data.status,'ok');assert.equal(data.strengths.length,3);assert.equal(calls,2);
});
test('Pages model outages and fabricated quotations do not become personalized claims',async()=>{
  for(const reply of [()=>new Response('',{status:429}),()=>model({route:'permission',evidence:'اقتباس مخترع'})]){
    const r=await handler({fetchImpl:async()=>reply()})(request('/api/reflect',{method:'POST',body:JSON.stringify(input)}),env);
    const result=await r.json();assert.ok(['rate_limited','invalid'].includes(result.status));assert.equal(result.evidence,'');assert.equal(result.route,'general');
  }
});
test('Pages diagnostics contain only operation codes, never answers, credentials or provider bodies',async()=>{
  const diagnostics=[];
  const handle=handler({onFailure:event=>diagnostics.push(event),fetchImpl:async()=>new Response(key+' '+input.revised.reason,{status:401})});
  const r=await handle(request('/api/reflect',{method:'POST',body:JSON.stringify(input)}),env);
  assert.deepEqual(await r.json(),{route:'general',status:'unavailable',evidence:''});
  assert.deepEqual(diagnostics,[{event:'qabas_model_failure',task:'reason',status:'unavailable',httpStatus:401,reason:'upstream_non_json'}]);
  assert.ok(!JSON.stringify(diagnostics).includes(key));assert.ok(!JSON.stringify(diagnostics).includes(input.revised.reason));
  const throws=handler({onFailure:()=>{throw Error('logger failed');},fetchImpl:async()=>new Response('',{status:503})});
  assert.equal((await throws(request('/api/reflect',{method:'POST',body:JSON.stringify(input)}),env)).status,200);
});
test('Pages rejects concurrent model work and resets its per-isolate minute cap',async()=>{
  let time=60001,release;
  const wait=new Promise(r=>release=r);
  const handle=handler({now:()=>time,fetchImpl:async()=>{await wait;return model({route:'general',evidence:''});}});
  const req=()=>request('/api/reflect',{method:'POST',body:JSON.stringify(input)});
  const first=handle(req(),env);await new Promise(r=>setTimeout(r,5));
  assert.equal((await handle(req(),env)).status,429);release();assert.equal((await first).status,200);
  for(let i=0;i<11;i++)assert.equal((await handle(req(),env)).status,200);
  assert.equal((await handle(req(),env)).status,429);time+=60000;assert.equal((await handle(req(),env)).status,200);
});
