import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPreviewServer} from '../src/http-app.mjs';
const learning={config:{provider:'groq',model:'openai/gpt-oss-120b',scope:'learning',configured:false},feedback:async()=>({status:'not_configured',strengths:[],additions:[]})};
const origin='https://qabas.example.invalid',password='synthetic-review-password-32-chars';
const authorization='Basic '+Buffer.from('qabas:'+password).toString('base64');
const withServer=async fn=>{const s=createPreviewServer({learning,origin,review:true,reviewPassword:password});await new Promise(r=>s.listen(0,'127.0.0.1',r));try{await fn(s.address().port);}finally{await new Promise(r=>s.close(r));}};
const req=(port,path='/',headers={},method='GET',body='')=>new Promise((resolve,reject)=>{
 const r=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:'qabas.example.invalid','X-Forwarded-Proto':'https',...headers}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));});r.on('error',reject);r.end(body);
});
test('hosted review refuses insecure origins, weak access setup and accidental non-loopback local preview',()=>{
 for(const options of [{origin:'http://qabas.example.invalid',review:true,reviewPassword:password},{origin,review:true,reviewPassword:'short'},{origin:origin+'/path',review:true,reviewPassword:password},{origin:'http://0.0.0.0:4173'}])assert.throws(()=>createPreviewServer({learning,...options}));
});
test('review authentication protects configuration, assets and API while health has no credentials',()=>withServer(async port=>{
 for(const path of ['/','/api/config','/app.js']){const r=await req(port,path);assert.equal(r.status,401);assert.ok(r.headers['www-authenticate'].includes('Basic'));assert.ok(!r.body.includes(password));}
 assert.equal((await req(port,'/api/config',{Authorization:'Basic '+Buffer.from('qabas:wrong').toString('base64')})).status,401);
 const health=await req(port,'/healthz');assert.deepEqual(JSON.parse(health.body),{status:'ok',mode:'review'});
 const config=await req(port,'/api/config',{Authorization:authorization});assert.equal(config.status,200);assert.deepEqual(JSON.parse(config.body),learning.config);assert.equal(config.headers['x-robots-tag'],'noindex, nofollow');assert.ok(config.headers['strict-transport-security']);
}));
test('review allows a protected top-level judging link but rejects cross-origin scripts and analysis',()=>withServer(async port=>{
 const h={Authorization:authorization,'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
 assert.equal((await req(port,'/api/config',h)).status,200);
 assert.equal((await req(port,'/api/config',{Authorization:authorization,'Sec-Fetch-Site':'cross-site'})).status,403);
 const api={Authorization:authorization,Origin:origin,'Content-Type':'application/json','X-Qabas-Request':'1'};
 assert.equal((await req(port,'/api/transfer-feedback',{...api,Origin:'https://attacker.example.invalid'},'POST','{}')).status,403);
 const r=await req(port,'/api/transfer-feedback',api,'POST','{}');assert.deepEqual(JSON.parse(r.body),{status:'not_configured',strengths:[],additions:[]});
}));
test('review rejects untrusted Host and HTTP before asking for a password',()=>withServer(async port=>{
 assert.equal((await req(port,'/api/config',{Host:'attacker.example.invalid',Authorization:authorization})).status,403);
 const r=await req(port,'/api/config',{'X-Forwarded-Proto':'http'});assert.equal(r.status,403);assert.equal(r.headers['www-authenticate'],undefined);
}));
