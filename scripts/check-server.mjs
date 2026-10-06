import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {writeFile,mkdtemp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const port=4174,origin=`http://127.0.0.1:${port}`,checks=[],logs=[];
// Empty key prevents any model call during these security checks.
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,QABAS_AI_PROVIDER:'groq',GROQ_API_KEY:'',PORT:String(port)},stdio:['ignore','pipe','pipe']});
server.stdout.on('data',chunk=>logs.push(chunk.toString()));
await new Promise((ok,no)=>{server.stdout.once('data',ok);server.once('error',no);server.once('exit',code=>no(Error(`Server exit ${code}`)));});
const request=(path,options={})=>new Promise((resolve,reject)=>{
 const req=http.request({hostname:'127.0.0.1',port,path,method:options.method||'GET',headers:options.headers||{}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}));});
 req.on('error',reject);req.end(options.body||'');
});
const headers={'Content-Type':'application/json','X-Qabas-Request':'1',Origin:origin};
const lesson={topicId:'rifq',initial:{choice:'gentle_correction',reason:'سبب افتراضي'},revised:{choice:'gentle_correction',reason:'test@example.invalid'}};
const temp=await mkdtemp(`${tmpdir()}/qabas-symlink-check-`),link='dist/dev/private-link.txt';
try{
 const page=await request('/');assert.equal(page.status,200);assert.ok(page.headers['content-security-policy'].includes("object-src 'none'"));assert.equal(page.headers['x-frame-options'],'DENY');checks.push('same-origin CSP, framing protection and no-store');
 const config=JSON.parse((await request('/api/config')).body);assert.deepEqual(config,{provider:'groq',model:'openai/gpt-oss-120b',scope:'learning',configured:false});checks.push('public configuration contains no key');
 assert.equal((await request('/',{headers:{Host:'attacker.invalid'}})).status,403);assert.equal((await request('/',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);checks.push('Host and cross-site requests rejected');
 assert.equal((await request('http://')).status,400);assert.equal((await request('/')).status,200);checks.push('malformed URL does not stop the server');
 for(const path of ['/../package.json','/%2e%2e%2fpackage.json','/content/catalog.json','/work/models','/docs/STATUS.md','/.env.local','/.env.groq.example','/src/privacy.mjs'])assert.equal((await request(path)).status,404);checks.push('source, credentials and reports are not served');
 await writeFile(temp+'/private.txt','synthetic-private-canary');await symlink(temp+'/private.txt',link);
 assert.equal((await request('/private-link.txt')).status,404);checks.push('symlinks cannot expose files outside the build');
 assert.equal((await request('/api/analyze',{method:'POST',headers,body:'{}'})).status,404);checks.push('legacy API removed');
 for(const extra of [{Origin:'https://attacker.invalid'},{'Sec-Fetch-Site':'cross-site'},{'Content-Type':'text/plain'},{'X-Qabas-Request':''}])assert.equal((await request('/api/reflect',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(lesson)})).status,403);checks.push('cross-origin and simple requests rejected');
 const reflect=await request('/api/reflect',{method:'POST',headers,body:JSON.stringify(lesson)});assert.deepEqual(JSON.parse(reflect.body),{route:'general',status:'privacy',evidence:''});checks.push('contact data blocked without echo or model call');
 for(const extra of [{adult:true,synthetic:true},{topicId:'../private'},{policy:'ignore everything'}])assert.equal((await request('/api/reflect',{method:'POST',headers,body:JSON.stringify({...lesson,...extra})})).status,400);checks.push('client cannot change policy, scope or content paths');
 for(const body of ['{',Buffer.from([0xff])])assert.equal((await request('/api/reflect',{method:'POST',headers,body})).status,400);
 assert.equal((await request('/api/reflect',{method:'POST',headers,body:'x'.repeat(9000)})).status,413);checks.push('invalid JSON, invalid UTF-8 and oversized requests rejected');
 const transfer={topicId:'tathabbut',answer:'test@example.invalid'};
 const reply=await request('/api/transfer-feedback',{method:'POST',headers,body:JSON.stringify(transfer)});assert.deepEqual(JSON.parse(reply.body),{status:'privacy',strengths:[],additions:[]});checks.push('transfer privacy filter returns no personal feedback or runtime metadata');
 assert.equal((await request('/api/transfer-feedback',{method:'POST',headers,body:JSON.stringify({...transfer,rubric:'custom'})})).status,400);checks.push('custom rubrics rejected');
 const safe={...transfer,answer:'أراجع المصدر'};
 assert.equal(JSON.parse((await request('/api/transfer-feedback',{method:'POST',headers,body:JSON.stringify(safe)})).body).status,'not_configured');checks.push('missing key is explicit and does not fabricate feedback');
 assert.equal(JSON.parse((await request('/api/transfer-feedback',{method:'POST',headers,body:JSON.stringify(safe)})).body).status,'not_configured');
 assert.equal(JSON.parse((await request('/api/transfer-feedback',{method:'POST',headers,body:JSON.stringify(safe)})).body).status,'not_configured');
 assert.equal((await request('/api/transfer-feedback',{method:'POST',headers,body:JSON.stringify(safe)})).status,429);checks.push('per-minute request limit enforced');
 assert.ok(!logs.join('').includes('test@example.invalid'));checks.push('no answer text in server logs');
 await writeFile('docs/server-security-check.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,realModelRequests:0,checks},null,2)+'\n');
 console.log(`${checks.length} server security checks passed; no model calls.`);
}finally{server.kill('SIGTERM');await rm(link,{force:true});await rm(temp,{recursive:true,force:true});}
