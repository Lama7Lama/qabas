import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {privateSecrets,publicationPaths,publicationBytes} from '../src/publication.mjs';
const root='dist/cloudflare',secrets=await privateSecrets(),paths=await publicationPaths(root),entries=[];
const special=new Set(['_worker.js','_routes.json','404.html']);
const build=JSON.parse(await readFile('work/cloudflare/build-meta.json','utf8'));
const assets=new Set(build.assets.map(path=>path.slice(1)).filter(Boolean));
for(const path of paths){
  const relative=path.slice(root.length+1);
  if(!special.has(relative)&&!assets.has(relative))throw Error('Unexpected hosted file: '+relative);
  const data=await publicationBytes(relative,{root,secrets,target:'cloudflare'});
  entries.push({path:relative,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
const worker=await readFile(root+'/_worker.js','utf8');
if(/\bimport\s*\(/.test(worker)||/\bfrom\s*["']node:/.test(worker))throw Error('Unexpected runtime dependency');
const routes=JSON.parse(await readFile(root+'/_routes.json','utf8'));
if(JSON.stringify(routes)!==JSON.stringify({version:1,include:['/*'],exclude:[]}))throw Error('Protected preview requires Functions on all routes');
const report={checkedAt:new Date().toISOString(),passed:true,knownSecretsChecked:secrets.length,fileCount:entries.length,workerBytes:Buffer.byteLength(worker),sourceMaps:false,privateFonts:false,files:entries,limitations:'Artifact checks do not confirm Cloudflare account setup, CPU limits, fail-closed platform behavior, or a successful live deployment.'};
await mkdir('work/cloudflare',{recursive:true});await writeFile('work/cloudflare/artifact-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,fileCount:entries.length,knownSecretsChecked:secrets.length,workerBytes:report.workerBytes}));
