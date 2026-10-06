import assert from 'node:assert/strict';
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const env=await readFile('.env.local','utf8');
const secrets=[...env.matchAll(/^[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*([^\r\n]+)/gm)].map(m=>m[1].trim().replace(/^(['"])(.*)\1$/,'$2')).filter(Boolean);
assert.ok(secrets.length,'A local key is required for the isolation check');
const walk=async dir=>{const files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())files.push(...await walk(path));else files.push(path);}return files;};
const files=await walk('dist/dev');
for(const path of files){const bytes=await readFile(path);assert.ok(secrets.every(secret=>!bytes.includes(Buffer.from(secret))),'Private key found in public build');}
assert.equal((await stat('.env.local')).mode&0o777,0o600);
const base='http://127.0.0.1:4173';
const config=await (await fetch(base+'/api/config')).json();assert.deepEqual(Object.keys(config).sort(),['configured','model','provider','scope']);
assert.ok(secrets.every(secret=>!JSON.stringify(config).includes(secret)));
for(const path of ['/.env.local','/src/transfer-feedback.mjs','/docs/evaluations/'])assert.equal((await fetch(base+path)).status,404);
await writeFile('docs/key-isolation-check.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,keysChecked:secrets.length,filesScanned:files.length,environmentMode:'0600',configFields:Object.keys(config),privateFiles404:true,keyAbsentFromPublicBuild:true},null,2)+'\n');
console.log(`${files.length} public build files checked; ${secrets.length} keys isolated. No API model calls.`);
