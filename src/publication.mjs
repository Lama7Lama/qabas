import {readFile,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
const patterns=[/gsk_[A-Za-z0-9]{25,}/,/AIza[A-Za-z0-9_-]{30,}/,/sk-(?:proj-|live-)?[A-Za-z0-9_-]{30,}/,/(?:ghp_|github_pat_)[A-Za-z0-9_]{25,}/,/AKIA[0-9A-Z]{16}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
export async function privateSecrets(){
  const secrets=[];
  for(const name of ['.env.local','.dev.vars']){
    try{
      const text=await readFile(name,'utf8');
      for(const match of text.matchAll(/^[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*([^\r\n]+)/gm)){
        const value=match[1].trim().replace(/^(['"])(.*)\1$/,'$2');if(value.length>=8)secrets.push(value);
      }
    }catch(error){if(error.code!=='ENOENT')throw Error('Private settings could not be checked');}
  }
  return [...new Set(secrets)];
}
export function publicationIssue(path,data,{secrets=[],target='github'}={}){
  if(path.includes('..')||path.includes('\\')||/[\r\n\0]/.test(path))return 'unsafe path';
  if(/(?:^|\/)(?:\.git|\.wrangler|node_modules|work|deliverables|coverage|test-results|playwright-report)(?:\/|$)/.test(path))return 'private or generated path';
  if(/(?:^|\/)(?:\.env(?:$|\.)|\.dev\.vars)/.test(path)&&!(target==='github'&&path==='.env.groq.example'))return 'private settings';
  if(/\.(?:pptx|pdf|docx|zip|pem|key|log|map|otf)$/i.test(path))return 'private or unnecessary asset';
  const text=data.toString('utf8');
  if(secrets.some(s=>data.includes(Buffer.from(s)))||patterns.some(p=>p.test(text)))return 'potential secret';
  if(/\/Users\/[^/\s'"<>]+\//.test(text)||/[A-Z]:\\Users\\[^\\\s'"<>]+\\/i.test(text))return 'personal machine path';
  if(path.endsWith('.svg')&&/<script\b|<foreignObject\b|\son\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|javascript:)/i.test(text))return 'active SVG';
  return null;
}
export async function publicationBytes(path,{root=process.cwd(),secrets=[],target='github'}={}){
  const absolute=resolve(root,path),info=await lstat(absolute),canonical=await realpath(absolute);
  if(!info.isFile()||info.isSymbolicLink()||!canonical.startsWith(resolve(root)+sep)||info.size>5*1024*1024)throw Error('Invalid publication file: '+path);
  const data=await readFile(absolute),issue=publicationIssue(path,data,{secrets,target});
  if(issue)throw Error(issue+': '+path);return data;
}
export async function publicationPaths(dir){
  const paths=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isSymbolicLink())throw Error('Symlink requires review: '+path);
    if(entry.isDirectory())paths.push(...await publicationPaths(path));else paths.push(path);
  }
  return paths;
}
