import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {spawn} from 'node:child_process';

// Publish only the checked snapshot. Credentials stay with Wrangler and Pages
// Secrets; neither the source checkout nor local environment files are uploaded.
await import('./build-cloudflare.mjs');
await import('./check-cloudflare.mjs');
const report=JSON.parse(await readFile('work/cloudflare/artifact-check.json','utf8'));
if(report.passed!==true||!report.files.length)throw Error('Checked hosted files required');
const stage=await mkdtemp('work/cloudflare/deploy-');
for(const file of report.files){
  if(!file.path||file.path.split('/').some(p=>!p||p==='.'||p==='..')||file.path.includes('\\'))throw Error('Invalid hosted path');
  const data=await readFile(resolve('dist/cloudflare',file.path));
  if(createHash('sha256').update(data).digest('hex')!==file.sha256)throw Error('Hosted bytes changed after inspection: '+file.path);
  const path=resolve(stage,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,data);
}
const args=['node_modules/wrangler/bin/wrangler.js','pages','deploy',stage,'--project-name','qabas','--branch','main','--commit-message','Deploy checked Qabas review','--commit-dirty=true'];
if(process.env.QABAS_DEPLOY_COMMIT){
  if(!/^[a-f0-9]{40}$/.test(process.env.QABAS_DEPLOY_COMMIT))throw Error('Invalid deployment commit');
  args.push('--commit-hash',process.env.QABAS_DEPLOY_COMMIT);
}
const child=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
if(code!==0)throw Error('Pages did not confirm deployment');
