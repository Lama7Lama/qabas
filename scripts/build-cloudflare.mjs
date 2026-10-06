import {readFile,writeFile,readdir,mkdir,mkdtemp,rm,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {build as bundle} from 'esbuild';
import {build} from './build.mjs';

// Build the existing judging preview; never copy the private Camel fonts.
await mkdir('work/cloudflare',{recursive:true});
const out=await mkdtemp('work/cloudflare/build-');
try{
await build('dev',out,{brandFontDir:'work/non-distributed-fonts'});
const catalog=JSON.parse(await readFile(`${out}/data/catalog.json`,'utf8'));
catalog.about.hostingDisclosure='يستضيف Cloudflare الموقع وينفذ الاتصال بخدمة Groq؛ لذلك تمر إجابات التحليل عبره قبل وصولها إلى خدمة النموذج.';
await writeFile(`${out}/data/catalog.json`,JSON.stringify(catalog,null,2)+'\n');
const lessons=await Promise.all(catalog.topics.map(async topic=>[topic.id,JSON.parse(await readFile(`${out}/data/lessons/${topic.id}.json`,'utf8'))]));
const paths=['/'];
async function walk(dir,prefix=''){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(prefix,entry.name);
    if(entry.isSymbolicLink())throw Error('Symlinks are not allowed in hosted assets');
    if(entry.isDirectory())await walk(join(dir,entry.name),path);else paths.push('/'+path);
  }
}
await walk(out);
const entry=`import {createPagesHandler} from './cloudflare-pages.mjs';
const lessons=new Map(${JSON.stringify(lessons)});
const paths=new Set(${JSON.stringify(paths)});
const onFailure=failure=>console.warn(JSON.stringify(failure));
const secure=createPagesHandler({lessons,assetPaths:paths,onFailure});
const local=createPagesHandler({lessons,assetPaths:paths,allowLocal:true,onFailure});
export default {fetch(request,env){return (env.QABAS_LOCAL_PREVIEW==='1'?local:secure)(request,env)}};`;
const result=await bundle({stdin:{contents:entry,resolveDir:resolve('src'),sourcefile:'cloudflare-entry.mjs'},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:`${out}/_worker.js`,minify:true,sourcemap:false,metafile:true});
if(Object.values(result.metafile.outputs).some(output=>output.imports.length))throw Error('Hosted worker must be self-contained');
await writeFile(`${out}/_routes.json`,JSON.stringify({version:1,include:['/*'],exclude:[]},null,2)+'\n');
// Pages' default SPA fallback must not return the home page for private paths.
await writeFile(`${out}/404.html`,'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>قبس</title><p>الصفحة غير موجودة.</p></html>\n');
await writeFile('work/cloudflare/build-meta.json',JSON.stringify({createdAt:new Date().toISOString(),assets:paths,workerBytes:result.metafile.outputs[`${out}/_worker.js`].bytes,inputs:Object.keys(result.metafile.inputs)},null,2)+'\n');
await rm('dist/cloudflare',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await rename(out,'dist/cloudflare');
console.log('Cloudflare review built: frontend assets and bundled server code; no keys or source maps.');
}finally{await rm(out,{recursive:true,force:true});}
