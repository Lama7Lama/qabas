import {readFile,writeFile,mkdir,rm,cp,rename,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateCollection} from '../src/content.mjs';
export async function build(mode='dev', out=`dist/${mode}`, {brandFontDir=process.env.QABAS_BRAND_FONT_DIR||'work/private-fonts'}={}) {
  if(!['dev','release'].includes(mode)) throw Error('Mode must be dev or release');
  // Remove stale release artifacts even when validation fails.
  if(mode==='release')await rm(out,{recursive:true,force:true});
  const catalog=JSON.parse(await readFile('content/catalog.json','utf8'));
  if(!Array.isArray(catalog.topics)||catalog.topics.some(t=>!/^(?:lessons\/)?[a-z_]+\.json$/.test(t.contentPath||''))) throw Error('Invalid catalog paths');
  const contents=new Map();
  for(const topic of catalog.topics)contents.set(topic.id,JSON.parse(await readFile(`content/${topic.contentPath}`,'utf8')));
  const errors=validateCollection(catalog,contents,{release:mode==='release'});
  if(errors.length) throw Error(errors.join('\n'));
  const content=contents.get('tathabbut');
  const staging=`${out}.next`;await rm(staging,{recursive:true,force:true});
  await mkdir(`${staging}/data/lessons`,{recursive:true});
  for(const file of ['index.html','style.css','app.js','flow.js']) await cp(`src/web/${file}`,`${staging}/${file}`);
  await cp('src/web/fonts',`${staging}/fonts`,{recursive:true});
  await cp('src/web/brand',`${staging}/brand`,{recursive:true});
  const privateFonts=['camel-year-regular.otf','camel-year-bold.otf'];
  let usePrivateFonts=false;
  if(mode==='dev'){
    try{await Promise.all(privateFonts.map(name=>access(resolve(brandFontDir,name))));usePrivateFonts=true;}catch{}
  }
  if(usePrivateFonts)for(const name of privateFonts)await cp(resolve(brandFontDir,name),`${staging}/fonts/${name}`);
  else await writeFile(`${staging}/style.css`,(await readFile(`${staging}/style.css`,'utf8')).replace(/^@font-face[^\n]*camel-year[^\n]*\n/gm,''));
  // Review records remain in source; the browser receives only the journey contract.
  const publicLesson=lesson=>({schemaVersion:lesson.schemaVersion,topic:lesson.topic,mode,records:lesson.records.map(r=>Object.fromEntries(['id','kind','text','version','status','value','citation','url','sourceIds','excerpt'].filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]])))});
  await writeFile(`${staging}/data/content.json`,JSON.stringify(publicLesson(content),null,2));
  for(const [id,lesson] of contents){
    await writeFile(`${staging}/data/lessons/${id}.json`,JSON.stringify(publicLesson(lesson),null,2));
  }
  // Only validated catalog identifiers become browser paths.
  await writeFile(`${staging}/data/catalog.json`,JSON.stringify({topics:catalog.topics.map(({id,title,description,journeyStatus})=>({id,title,description,journeyStatus})),...(catalog.humanSupport?{humanSupport:catalog.humanSupport}:{}),...(catalog.about?{about:catalog.about}:{})},null,2));
  await rm(out,{recursive:true,force:true});await rename(staging,out);
  console.log(`Built ${mode}: ${out}`);
}
if(process.argv[1]?.endsWith('/build.mjs')) build(process.argv[2]||'dev').catch(e=>{console.error(e.message);process.exitCode=1});
