import {readFile} from 'node:fs/promises';
import {validateCollection} from './content.mjs';
import {createLessonAIService as createCoreService} from './lesson-ai-core.mjs';
export {prepareLesson} from './lesson-ai-core.mjs';

export async function loadLessons(){
  const catalog=JSON.parse(await readFile(new URL('../content/catalog.json',import.meta.url),'utf8'));
  if(!Array.isArray(catalog.topics)||catalog.topics.some(t=>!/^(?:lessons\/)?[a-z_]+\.json$/.test(t.contentPath||'')))throw Error('Invalid catalog paths');
  const lessons=new Map(await Promise.all(catalog.topics.map(async t=>[t.id,JSON.parse(await readFile(new URL(`../content/${t.contentPath}`,import.meta.url),'utf8'))])));
  const errors=validateCollection(catalog,lessons);if(errors.length)throw Error(errors.join('\n'));
  return lessons;
}
export async function createLessonAIService(options={}){
  return createCoreService({...options,lessons:options.lessons??await loadLessons()});
}
