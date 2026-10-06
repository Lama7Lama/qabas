import http from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {readJSONBody} from './http-input.mjs';
export function createPreviewServer({learning,root:siteRoot='dist/dev',origin,review=false,reviewPassword}={}){
  const address=new URL(origin);
  if(address.origin!==origin||address.username||address.password||address.pathname!=='/'||address.search||address.hash)throw Error('A canonical origin is required');
  if(review&&(address.protocol!=='https:'||typeof reviewPassword!=='string'||reviewPassword.trim().length<20||reviewPassword.length>200))throw Error('HTTPS origin and a review password of 20..200 characters are required');
  if(!review&&(address.protocol!=='http:'||address.hostname!=='127.0.0.1'))throw Error('Local preview must use loopback');
  if(!learning?.config)throw Error('Learning service is required');
  const root=resolve(siteRoot),host=address.host;
  const passwordHash=review?createHash('sha256').update('qabas:'+reviewPassword).digest():null;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.ttf':'font/ttf','.otf':'font/otf','.svg':'image/svg+xml'};
const headers={...(review?{'Strict-Transport-Security':'max-age=31536000','X-Robots-Tag':'noindex, nofollow'}:{}),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
let active=false,windowStart=0,count=0;
const server=http.createServer(async(req,res)=>{
  const send=(code,data,type='application/json; charset=utf-8')=>{
    if(res.destroyed||res.writableEnded)return;
    res.writeHead(code,{...headers,'Content-Type':type,...(code===413?{Connection:'close'}:{})});res.end(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data));
  };
  if(review && req.url==='/healthz' && ['GET','HEAD'].includes(req.method))return send(200,req.method==='HEAD'?'':{status:'ok',mode:'review'});
  const navigation=req.method==='GET'&&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
  if(req.headers.host!==host||req.headers['sec-fetch-site']==='cross-site'&&!(review&&navigation))return send(403,{error:'forbidden'});
  if(review){
    if(req.headers['x-forwarded-proto']!=='https')return send(403,{error:'https_required'});
    const authorization=req.headers.authorization;
    let credential='';
    if(typeof authorization==='string'&&authorization.length<=512&&/^Basic [A-Za-z0-9+/]+={0,2}$/.test(authorization))credential=Buffer.from(authorization.slice(6),'base64').toString('utf8');
    if(!timingSafeEqual(createHash('sha256').update(credential).digest(),passwordHash)){
      res.setHeader('WWW-Authenticate','Basic realm="Qabas review", charset="UTF-8"');
      return send(401,{error:'review_access_required'});
    }
  }
  let url;try{url=new URL(req.url,origin);}catch{return send(400,{error:'invalid_request'});}
  if(url.pathname==='/api/config'){
    if(!['GET','HEAD'].includes(req.method))return send(405,{error:'method'});
    return send(200,req.method==='HEAD'?'':learning.config);
  }
  if(['/api/reflect','/api/transfer-feedback'].includes(url.pathname)){
    if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-qabas-request']!=='1'||req.headers['content-type']!=='application/json')return send(403,{error:'forbidden'});
    if(Date.now()-windowStart>60000){windowStart=Date.now();count=0;}if(active||++count>12)return send(429,{error:'busy'});
    active=true;const controller=new AbortController();res.on('close',()=>controller.abort());
    try{
      const input=await readJSONBody(req),transfer=url.pathname==='/api/transfer-feedback';
      const result=await (transfer?learning.feedback(input,{signal:controller.signal}):learning.analyze(input,{signal:controller.signal}));
      send(200,transfer?{status:result.status,strengths:result.strengths,additions:result.additions}:{route:result.route,status:result.status,evidence:result.evidence});
    }catch(error){send(error.statusCode===413?413:400,{error:error.statusCode===413?'too_large':'invalid_request'});}finally{active=false;}
    return;
  }
  if(url.pathname.startsWith('/api/'))return send(404,{error:'not_found'});
  if(!['GET','HEAD'].includes(req.method))return send(405,{error:'method'});
  try{
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    const canonicalRoot=await realpath(root),canonicalPath=await realpath(path);
    if(!path.startsWith(root+sep)||!canonicalPath.startsWith(canonicalRoot+sep)||!types[extname(path)]||!(await stat(canonicalPath)).isFile())return send(404,{error:'not_found'});
    send(200,req.method==='HEAD'?'':await readFile(canonicalPath),types[extname(path)]);
  }catch{send(404,{error:'not_found'});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
return server;
}
