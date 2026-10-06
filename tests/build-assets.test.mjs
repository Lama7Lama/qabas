import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {build} from '../scripts/build.mjs';
test('a clean checkout builds with licensed fallback fonts and no private review metadata',async()=>{
 const temp=await mkdtemp(`${tmpdir()}/qabas-public-assets-`);
 try{
  await build('dev',temp+'/site',{brandFontDir:temp+'/missing-private-fonts'});
  await access(temp+'/site/fonts/tajawal-regular.ttf');await access(temp+'/site/fonts/OFL.txt');
  await assert.rejects(access(temp+'/site/fonts/camel-year-regular.otf'));
  assert.ok(!(await readFile(temp+'/site/style.css','utf8')).includes('camel-year-regular.otf'));
  const lesson=JSON.parse(await readFile(temp+'/site/data/content.json','utf8'));
  assert.deepEqual(Object.keys(lesson).sort(),['mode','records','schemaVersion','topic']);
  assert.ok(lesson.records.every(r=>!r.approval&&!r.rights));
 }finally{await rm(temp,{recursive:true,force:true});}
});
