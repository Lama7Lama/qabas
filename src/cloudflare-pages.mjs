import {createLessonAIService} from './lesson-ai-core.mjs';

const headers = {
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY',
  'Cross-Origin-Resource-Policy':'same-origin', 'X-Robots-Tag':'noindex, nofollow',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()'
};
const fail = (status, message) => Object.assign(new Error(message), {statusCode:status});
const encoder = new TextEncoder();
async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
async function authorized(request,password){
  const value=request.headers.get('authorization');
  let credential='';
  if(value && value.length<=512 && /^Basic [A-Za-z0-9+/]+={0,2}$/.test(value)){
    try{credential=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.slice(6)),c=>c.charCodeAt(0)));}catch{}
  }
  const [received,expected]=await Promise.all([digest(credential),digest('qabas:'+password)]);
  let difference=0;for(let i=0;i<expected.length;i++)difference|=received[i]^expected[i];
  return difference===0;
}
export async function readPagesJSON(request,{maxBytes=8192,timeoutMs=15000}={}){
  const length=request.headers.get('content-length');
  if(length!==null && (!/^\d+$/.test(length)||Number(length)>maxBytes))throw fail(413,'too_large');
  const reader=request.body?.getReader();if(!reader)throw fail(400,'invalid_request');
  const chunks=[];let bytes=0,timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(fail(408,'request_timeout'));void reader.cancel().catch(()=>{});},timeoutMs);});
  try{
    while(true){
      const {done,value}=await Promise.race([reader.read(),timeout]);if(done)break;
      bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel();throw fail(413,'too_large');}
      chunks.push(value);
    }
    const body=new Uint8Array(bytes);let offset=0;
    for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
  }finally{clearTimeout(timer);reader.releaseLock();}
}

// The review password and the limits remain server-side. Counters apply to one
// isolate, not globally across Cloudflare's network; no answers or IPs are saved.
export function createPagesHandler({lessons,assetPaths,fetchImpl=globalThis.fetch,now=Date.now,allowLocal=false}={}){
  if(!(lessons instanceof Map)||!(assetPaths instanceof Set))throw Error('Trusted build data required');
  let active=false,windowStart=0,count=0;
  return async function handle(request,env){
    const url=new URL(request.url),secure=url.protocol==='https:';
    const send=(status,data,extra={})=>new Response(request.method==='HEAD'?null:JSON.stringify(data),{status,headers:{...headers,...(secure?{'Strict-Transport-Security':'max-age=31536000'}:{}),'Content-Type':'application/json; charset=utf-8',...extra}});
    let origin;
    try{
      const configured=new URL(env.QABAS_PUBLIC_ORIGIN);
      if(configured.origin!==env.QABAS_PUBLIC_ORIGIN||configured.username||configured.password)throw Error();
      if(configured.protocol!=='https:' && !(allowLocal && configured.protocol==='http:' && configured.hostname==='127.0.0.1'))throw Error();
      origin=configured.origin;
    }catch{return send(503,{error:'configuration_required'});}
    if(url.origin!==origin || !secure && !(allowLocal && url.hostname==='127.0.0.1'))return send(403,{error:'forbidden'});
    const password=env.QABAS_REVIEW_PASSWORD;
    if(typeof password!=='string'||password.trim().length<20||password.length>200)return send(503,{error:'configuration_required'});
    const key=typeof env.GROQ_API_KEY==='string'?env.GROQ_API_KEY:'';
    if(url.pathname==='/healthz' && ['GET','HEAD'].includes(request.method))return send(key.trim()?200:503,{status:key.trim()?'ok':'configuration_required',mode:'review'});
    const navigation=request.method==='GET' && request.headers.get('sec-fetch-mode')==='navigate' && request.headers.get('sec-fetch-dest')==='document';
    if(request.headers.get('sec-fetch-site')==='cross-site'&&!navigation)return send(403,{error:'forbidden'});
    if(!await authorized(request,password))return send(401,{error:'review_access_required'},{'WWW-Authenticate':'Basic realm="Qabas review", charset="UTF-8"'});
    const service=()=>createLessonAIService({lessons,provider:'groq',apiKey:key,fetchImpl,maxRequests:2});
    if(url.pathname==='/api/config'){
      if(!['GET','HEAD'].includes(request.method))return send(405,{error:'method'});
      return send(200,service().config);
    }
    if(['/api/reflect','/api/transfer-feedback'].includes(url.pathname)){
      if(request.method!=='POST'||request.headers.get('origin')!==origin||request.headers.get('x-qabas-request')!=='1'||request.headers.get('content-type')!=='application/json')return send(403,{error:'forbidden'});
      const time=now();if(time-windowStart>=60000){windowStart=time;count=0;}
      if(active||count>=12)return send(429,{error:'busy'},{'Retry-After':'60'});
      count++;active=true;
      try{
        const input=await readPagesJSON(request),transfer=url.pathname==='/api/transfer-feedback';
        const ai=service(),result=await (transfer?ai.feedback(input,{signal:request.signal}):ai.analyze(input,{signal:request.signal}));
        return send(200,transfer?{status:result.status,strengths:result.strengths,additions:result.additions}:{route:result.route,status:result.status,evidence:result.evidence});
      }catch(error){
        const status=[408,413].includes(error.statusCode)?error.statusCode:400;
        return send(status,{error:status===413?'too_large':status===408?'request_timeout':'invalid_request'});
      }finally{active=false;}
    }
    if(url.pathname.startsWith('/api/'))return send(404,{error:'not_found'});
    if(!['GET','HEAD'].includes(request.method))return send(405,{error:'method'});
    let path;try{path=decodeURIComponent(url.pathname);}catch{return send(400,{error:'invalid_request'});}
    if(!assetPaths.has(path))return send(404,{error:'not_found'});
    try{
      // Do not forward the review credential or cookies to asset fetching.
      const assetHeaders=new Headers(request.headers);assetHeaders.delete('authorization');assetHeaders.delete('cookie');
      const asset=await env.ASSETS.fetch(new Request(url,{method:request.method,headers:assetHeaders}));
      const response=new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,headers:asset.headers});
      for(const [name,value] of Object.entries(headers))response.headers.set(name,value);
      if(secure)response.headers.set('Strict-Transport-Security','max-age=31536000');
      return response;
    }catch{return send(503,{error:'unavailable'});}
  };
}
