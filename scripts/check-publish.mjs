import {execFileSync} from 'node:child_process';
import {readFile,writeFile,lstat} from 'node:fs/promises';
const candidates=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
let privateKeys=[];
try{const env=await readFile('.env.local','utf8');privateKeys=[...env.matchAll(/^[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*([^\r\n]+)/gm)].map(m=>m[1].trim().replace(/^(['"])(.*)\1$/,'$2')).filter(Boolean);}catch{}
const patterns=[/gsk_[A-Za-z0-9]{25,}/g,/AIza[A-Za-z0-9_-]{30,}/g,/sk-(?:proj-|live-)?[A-Za-z0-9_-]{30,}/g,/(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}/g,/AKIA[0-9A-Z]{16}/g,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g];
const findings=[];let filesScanned=0;
for(let start=0;start<candidates.length;start+=16){
 const batch=await Promise.all(candidates.slice(start,start+16).map(async path=>{
  const info=await lstat(path);
  if(info.isSymbolicLink())return {path,issue:'symlink requires review'};
  if(/(?:^|\/)(?:work|dist|node_modules)\//.test(path)||/(?:^|\/)\.env(?:$|\.)/.test(path)&&path!=='.env.groq.example'||/camel-year.*\.otf$/i.test(path))return {path,issue:'private or generated file in Git candidate set'};
  if(info.size>10*1024*1024)return {path,issue:'large binary requires review'};
  const data=await readFile(path),text=data.toString('utf8');filesScanned++;
  if(privateKeys.some(key=>data.includes(Buffer.from(key)))||patterns.some(pattern=>{pattern.lastIndex=0;return pattern.test(text);}))return {path,issue:'potential secret'};
  if(/\/Users\/[^/\s'"<>]+\//.test(text)||/[A-Z]:\\Users\\[^\\\s'"<>]+\\/i.test(text))return {path,issue:'personal machine path'};
  if(path.endsWith('.svg')&&/<script\b|<foreignObject\b|\son\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|javascript:)/i.test(text))return {path,issue:'active or external SVG content'};
  return null;
 }));findings.push(...batch.filter(Boolean));
}
for(const path of ['.env.local','work/private-fonts/camel-year-regular.otf','dist/dev/index.html']){
 try{execFileSync('git',['check-ignore','--no-index','-q',path],{stdio:'ignore'});}catch{findings.push({path,issue:'required ignore rule is missing'});}
}
const report={checkedAt:new Date().toISOString(),passed:findings.length===0,filesScanned,findings,limitations:'Checks the current Git candidate set for secrets, private assets, personal paths and active SVG content. Does not certify application security, copyright clearance, provider terms or deployment readiness.'};
await writeFile('docs/publication-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,filesScanned,findings}));
if(!report.passed)process.exitCode=1;
