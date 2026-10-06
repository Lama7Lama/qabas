export function excerptOptions(reason){
  const options=[''];
  for(const match of reason.matchAll(/[^،,؛;.!؟?\n]+/gu)){
    const span=match[0].trim();if(!span)continue;
    if(span.length<=120)options.push(span);
    else {let offset=0;while(offset<span.length){let end=Math.min(offset+120,span.length);if(end<span.length){const space=span.lastIndexOf(' ',end);if(space>offset)end=space;if(/[\uD800-\uDBFF]/.test(span[end-1]))end--;}
      const excerpt=span.slice(offset,end).trim();if(excerpt)options.push(excerpt);offset=end;}}
  }
  if(reason.length<=120)options.push(reason);
  return [...new Set(options)];
}
export function evidenceMap(answer){return Object.fromEntries(excerptOptions(answer).filter(Boolean).map((span,index)=>['e'+(index+1),span]));}
export const exactKeys=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).sort().join(',')===[...keys].sort().join(',');
