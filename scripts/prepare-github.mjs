import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {privateSecrets,publicationPaths,publicationBytes} from '../src/publication.mjs';
const stage='work/github-publish',secrets=await privateSecrets();
const files=['package.json','package-lock.json','.gitignore','.env.groq.example','wrangler.jsonc',
 'docs/CLOUDFLARE.md','docs/SECURITY.md','docs/THIRD_PARTY.md','docs/CONTENT_REVIEW.md','docs/GROQ-SETUP.md','docs/DEPLOYMENT.md',
 'docs/evaluations/assessment-content-baseline-2026-10-05.json',
 'eval/six-lessons-development.json','eval/personal-feedback-development.json'];
for(const dir of ['src','content','tests'])files.push(...await publicationPaths(dir));
for(const name of ['serve','serve-review','build','build-review','build-cloudflare','deploy-cloudflare','browser-runtime','check-assessment-verdict-browser','check-server','check-key-isolation','check-publish','check-cloudflare','prepare-github','model-comparison-metrics'])files.push('scripts/'+name+'.mjs');
const snapshots=new Map();
for(const path of [...new Set(files)].sort())snapshots.set(path,await publicationBytes(path,{secrets}));
const pkg=JSON.parse(snapshots.get('package.json'));
const commands=new Set(['serve','serve:groq','test','check:server','check:browser','check:publish','build','build:release','build:review','start:review','build:cloudflare','dev:cloudflare','deploy:cloudflare','check:cloudflare','prepare:github']);
pkg.scripts=Object.fromEntries(Object.entries(pkg.scripts).filter(([name])=>commands.has(name)));
snapshots.set('package.json',Buffer.from(JSON.stringify(pkg,null,2)+'\n'));
let readme;try{readme=await readFile('docs/GITHUB-README.md');}catch(error){if(error.code!=='ENOENT')throw error;readme=await readFile('README.md');}
snapshots.set('README.md',Buffer.from(readme));
// Read and inspect exact bytes before staging, then hash that same snapshot.
for(const [path,data] of snapshots){
  const issue=(await import('../src/publication.mjs')).publicationIssue(path,data,{secrets});if(issue)throw Error(issue+': '+path);
}
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
const entries=[];
for(const [path,data] of snapshots){
  const target=resolve(stage,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,data);
  entries.push({path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
const report={createdAt:new Date().toISOString(),fileCount:entries.length,secretsExcluded:true,rawParticipantDataExcluded:true,documentsAndPresentationsExcluded:true,privateFontsExcluded:true,historyExcluded:true,knownSecretsChecked:secrets.length,files:entries};
await writeFile('work/github-publish-manifest.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({stage,fileCount:entries.length,knownSecretsChecked:secrets.length,privateFilesExcluded:true}));
