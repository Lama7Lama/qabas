import {createJourney,transition,validFeedback,feedbackVerdict,escapeHTML as e,readCheckpoint,saveCheckpoint} from './flow.js';
const stage=document.querySelector('#stage'),main=document.querySelector('main');
let storage;try{storage=window.localStorage;}catch{storage={getItem:()=>null,setItem:()=>{throw Error()},removeItem:()=>{}};}
let catalog,content,records,refs,aiConfig,state,busy=false,controller,save=false,correcting=false,lessonTicket=0,aboutBody='مواقف يومية تقرب القيم الإسلامية.';
const text=id=>records[id]?.text||'';
const p=id=>id?`<p>${e(text(id))}</p>`:'';
const button=(label,action,kind='primary')=>`<button class="${kind}" data-action="${action}" ${action==='dismiss-correction'?'formnovalidate':''}>${e(label)}</button>`;
const input=(label,value='')=>`<label class="prompt" for="reason">${e(label)}</label><textarea id="reason" name="reason" rows="3" maxlength="400" required aria-describedby="reason-error" placeholder="اكتب بطريقتك…">${e(value)}</textarea><div class="input-meta"><span id="count">${value.length.toLocaleString('ar')} / ٤٠٠</span></div><p id="reason-error" class="error" role="alert"></p>`;
const heading=(label,title)=>`<div class="stage-heading"><span class="eyebrow">${e(label)}</span><span class="time">${e(content.topic.value)}</span></div><h2 tabindex="-1">${e(title)}</h2>`;
const choices=selected=>`<fieldset><legend>${e(text(selected?(refs.revisedQuestion||refs.question):refs.question))}</legend><div class="choices">${refs.choices.map((id,i)=>`<label class="choice ${selected===records[id].value?'selected':''}"><input type="radio" name="choice" value="${e(records[id].value)}" ${selected===records[id].value?'checked':''} required><span class="choice-letter" aria-hidden="true">${['أ','ب','ج'][i]}</span><span>${e(text(id))}</span></label>`).join('')}</div></fieldset>`;
const checkpointVersion=()=>content.topic.id+':'+content.topic.version;
const freshJourney=()=>createJourney({choices:refs.choices.map(id=>records[id].value),routes:Object.keys(refs.followups)});
const notices={unavailable:'تعذر التحليل الآن؛ يمكنك متابعة الشرح.',invalid:'لم يصل تحليل صالح؛ يمكنك متابعة الشرح.',privacy:'قد تتضمن الكتابة بيانات تواصل؛ لم ترسل إلى النموذج.',not_configured:'خدمة التحليل غير متاحة الآن.',rate_limited:'بلغت الخدمة حد الاستخدام؛ يمكنك متابعة الشرح.',budget_exhausted:'بلغت هذه الجلسة حد طلبات التحليل.',busy:'خدمة التحليل مشغولة الآن.',unclear:'لم يتضح مبرر واحد في السبب؛ لنقرأ الشرح.'};
function updateSteps(){const n={decision:0,revision:1,followup:2,explanation:2,transfer:3,transfer_review:3,complete:3}[state.stage];document.querySelectorAll('#steps li').forEach((li,i)=>{li.className=i===n?'active':i<n?'done':'';if(i===n)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});}
function analysisCard(){
  if(correcting)return `<div class="feedback ai-reflection"><form id="correction-form">${input('ما الذي قصدته؟',state.revised.reason)}<div class="actions">${button('صحح فهم النظام','correct-reason')}${button('متابعة الشرح','dismiss-correction','secondary')}</div></form></div>`;
  if(state.analysisStatus==='ok'&&state.evidence&&refs.understandings?.[state.route]&&!['general','clarify'].includes(state.route))return `<div class="feedback ai-reflection"><h3>ما فهمه النظام من سببك</h3><p class="quote">ذكرت: «${e(state.evidence)}»</p><p>فهمت من عبارتك أنك ${e(text(refs.understandings[state.route]))}</p>${state.correctionCount<1?button('هذا ما قصدته','correct-understanding','text-button small'):button('إخفاء هذا الفهم','dismiss-reflection','text-button small')}<h3>زاوية أخرى للتأمل</h3><p>${e(text(refs.followups[state.route]))}</p></div>`;
  return notices[state.analysisStatus]?`<p class="status" role="status">${notices[state.analysisStatus]}</p>${['unavailable','invalid','busy'].includes(state.analysisStatus)?button('إعادة التحليل','retry','secondary'):''}`:'';
}
const feedbackNotices={unclear:'لم تتضح إجابتك بما يكفي لتعليق شخصي.',unverified:'لم يتمكن النظام من تقديم تعليق موثوق على هذه الإجابة.',outside:'تحتاج إجابتك إلى سياق مختلف؛ لن نقيمها بهذا الموقف.',unavailable:'تعذر تحليل الإجابة الآن.',invalid:'لم تجتز نتيجة التحليل التحقق؛ لم نعرضها.',privacy:'قد تتضمن الإجابة بيانات تواصل؛ لم ترسل إلى النموذج.',not_configured:'خدمة التعليق غير متاحة الآن.',rate_limited:'بلغت الخدمة حد الاستخدام.',budget_exhausted:'بلغت الجلسة حد طلبات التحليل.',busy:'خدمة التحليل مشغولة الآن.',skipped:'أكملت موقف التطبيق دون تعليق شخصي.'};
function groupedComments(items,criteria,strength=false){
 const groups=new Map();
 for(const item of items){const key=item.evidence;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(text(criteria[item.criterion][strength?'strength':item.kind==='opposed'?'concern':'addition']));}
 return [...groups].map(([quote,comments])=>`<div class="feedback-item">${quote?`<p class="quote">«${e(quote)}»</p>`:''}${comments.length===1?`<p>${e(comments[0])}</p>`:`<ul>${comments.map(comment=>`<li>${e(comment)}</li>`).join('')}</ul>`}</div>`).join('');
}
function choiceFeedbackCard(){
 const assessment=records[refs.choiceAssessments?.[state.revised.choice]];
 return `<div class="feedback neutral choice-feedback"><h3>عن التصرف الذي اخترته</h3>${assessment?`<p class="verdict ${e(assessment.value)}">${e(assessment.text)}</p>`:''}${p(refs.comments[state.revised.choice])}<p class="assessment-note">هذه ملاحظة على التصرف المختار؛ فهم السبب يظهر في تحليله وفي موقف التطبيق.</p></div>`;
}
const verdictLabels={appropriate:'جوابك سليم وفق معايير هذا الموقف',needs_addition:'جوابك في الاتجاه الصحيح، ويحتاج إضافة',needs_correction:'في جوابك نقطة تحتاج تصحيحا',partial:'ظهر جانب مناسب، وبقيت نقاط لم نتأكد منها'};
function transferFeedbackCard(){
 const feedback=state.feedback;if(feedback?.status!=='ok')return `<p class="status" role="status">${e(feedbackNotices[feedback?.status]||feedbackNotices.invalid)}</p>${['unavailable','invalid','busy'].includes(feedback?.status)?button('إعادة تحليل الإجابة','retry-transfer','secondary'):''}`;
 const criterion=refs.transferFeedback.criteria,ids=Object.keys(criterion),verdict=feedbackVerdict(feedback,ids,state.transferAnswer);
 if(!verdict)return `<p class="status" role="status">${e(feedbackNotices.invalid)}</p>`;
 const corrections=feedback.additions.filter(item=>item.kind==='opposed'),additions=feedback.additions.filter(item=>item.kind==='not_shown'),partial=feedback.strengths.length+feedback.additions.length<ids.length;
 return `<div class="feedback personal-feedback"><h3>تعليق على إجابتك</h3><p class="verdict ${verdict}" role="status">${e(verdictLabels[verdict])}</p><p class="assessment-note">تقييم تعليمي لما كتبته، وفق معايير الموقف.</p>${partial&&verdict!=='partial'?'<p class="assessment-note">بقيت نقاط لم نتأكد منها؛ الخلاصة تخص ما ظهر بوضوح فقط.</p>':''}${feedback.strengths.length?`<h4>ما أحسنت فيه</h4>${groupedComments(feedback.strengths,criterion,true)}`:''}${corrections.length?`<h4>ما يحتاج تصحيحا</h4>${groupedComments(corrections,criterion)}`:''}${additions.length?`<h4>ما يمكنك إضافته</h4>${groupedComments(additions,criterion)}`:''}</div>`;
}
function render(){
 updateSteps();
 if(state.stage==='decision')stage.innerHTML=heading('١ · اختيار وسبب',content.topic.title)+`<div class="story">${p(refs.intro)}</div>`+(refs.message?`<div class="message"><span class="message-label">رسالة معاد توجيهها</span>${p(refs.message)}${refs.missing?`<div class="message-bottom">${e(text(refs.missing))}</div>`:''}</div>`:'')+`<form id="decision-form">${choices()}${input(text(refs.reason))}<div class="actions">${button('اكتشف المعلومة الجديدة','decide')}</div></form>`;
 else if(state.stage==='revision')stage.innerHTML=heading('٢ · مراجعة القرار','معلومة جديدة')+`<div class="message">${p(refs.extra)}</div><details class="previous"><summary>قرارك الأول وسببه</summary>${p('choice.'+state.initial.choice)}<p>${e(state.initial.reason)}</p></details><form id="revision-form">${choices(state.initial.choice)}${input('ما سبب قرارك الآن؟')}<div class="actions">${button('لنقرأ الشرح','revise')}</div></form>`;
 else if(state.stage==='followup')stage.innerHTML=heading('٣ · الشرح والمصدر','نتأمل سببك')+`<p class="status" role="status">${busy?'جار تحليل السبب…':'يمكنك إعادة التحليل أو متابعة الشرح.'}</p><div class="actions">${busy?'':button('إعادة التحليل','retry')}${button('الانتقال إلى الشرح','fallback','secondary')}</div>`;
 else if(state.stage==='explanation')stage.innerHTML=heading('٣ · الشرح والمصدر',content.topic.value)+analysisCard()+choiceFeedbackCard()+`${p(refs.explanation)}<div class="source-card"><span class="label">${e(records[refs.source].citation)}</span><p class="verse">${e(text(refs.source))}</p><a class="source-link" href="${e(records[refs.source].url)}" target="_blank" rel="noopener noreferrer">فتح المصدر</a></div>`+([refs.sourceContext,refs.scopeNotes].some(Boolean)?`<details><summary>سياق الموقف والدليل</summary>${p(refs.sourceContext)}${p(refs.scopeNotes)}</details>`:'')+`<div class="actions">${button('لنطبق الفكرة في موقف جديد','transfer')}</div>`;
 else if(state.stage==='transfer')stage.innerHTML=heading('٤ · موقف التطبيق','كيف تتصرف في موقف جديد؟')+`<div class="message">${p(refs.transfer)}</div><form id="transfer-form">${input(state.transferRevisionCount?text(refs.transferFeedback.clarification):text(refs.transferPrompt),state.transferAnswer||'')}<div class="actions">${button('تعليق على إجابتي','finish')}</div></form>`;
 else if(state.stage==='transfer_review')stage.innerHTML=heading('٤ · موقف التطبيق','نقرأ إجابتك')+`<p class="status" role="status">جار تحليل إجابتك ومراجعة التعليق…</p><div class="actions">${button('المتابعة دون تعليق','skip-transfer','secondary')}</div>`;
 else stage.innerHTML=heading('اكتملت الرحلة','ما الذي ظهر في تطبيقك للفكرة؟')+transferFeedbackCard()+`<details><summary>إجابتك في موقف التطبيق</summary><p>${e(state.transferAnswer)}</p></details>${state.transferRevisionCount<1?button(state.feedback?.status==='unclear'?'أوضح إجابتي':'تعديل إجابتي','review-transfer','text-button'):''}<details class="optional-example"><summary>مثال اختياري</summary>${p(refs.transferExample)}</details><div class="actions">${nextTopic()?button('الموقف التالي: '+nextTopic().title,'next'):''}${button('لنعد الرحلة','restart','secondary')}</div>`;
 const reason=stage.querySelector('#reason');
 reason?.addEventListener('invalid',()=>reason.setCustomValidity(answerValidation()));
 reason?.addEventListener('input',()=>{reason.setCustomValidity('');stage.querySelector('#count').textContent=`${reason.value.length.toLocaleString('ar')} / ٤٠٠`;stage.querySelector('#reason-error').textContent='';});
 stage.querySelectorAll('[name="choice"]').forEach(r=>r.addEventListener('change',()=>stage.querySelectorAll('.choice').forEach(c=>c.classList.toggle('selected',c.querySelector('input').checked))));
 stage.querySelector('form')?.addEventListener('submit',ev=>{ev.preventDefault();handle(ev.submitter?.dataset.action);});
}
function nextTopic(){return catalog.topics[catalog.topics.findIndex(t=>t.id===content.topic.id)+1];}
function advance(event){state=transition(state,event);if(save)document.querySelector('#save-note').textContent=saveCheckpoint(storage,checkpointVersion(),state.stage)?'حفظ اسم المرحلة فقط، دون الإجابات.':'تعذر حفظ المرحلة.';render();focusStage();}
function focusStage(){stage.querySelector('h2')?.focus({preventScroll:true});main.scrollIntoView({behavior:'auto',block:'start'});}
function answerValidation(){return state.stage==='transfer'?'اكتب إجابتك أولا.':'اكتب سببك أولا.';}
function reason(){const value=stage.querySelector('#reason')?.value?.trim();if(!value){stage.querySelector('#reason-error').textContent=answerValidation();stage.querySelector('#reason').focus();return null;}return value;}
async function handle(action){
 if(action==='decide'||action==='revise'){const value=reason(),choice=stage.querySelector('[name="choice"]:checked')?.value;if(!value||!choice)return;advance({type:action==='decide'?'DECIDE':'REVISE',choice,reason:value});if(action==='revise')await analyze();}
 if(action==='finish'){const value=reason();if(value){advance({type:'FINISH',reason:value});await analyzeTransfer();}}
 if(action==='transfer')advance({type:'TRANSFER'});
 if(action==='retry'){controller?.abort();controller=null;busy=false;state.stage='followup';state.route=null;state.evidence=null;await analyze();}
 if(action==='fallback'){controller?.abort();controller=null;busy=false;advance({type:'ANALYSIS',route:'general',status:'general'});}
 if(action==='correct-understanding'){correcting=true;render();stage.querySelector('#reason')?.focus();}
 if(action==='correct-reason'){const value=reason();if(value){correcting=false;advance({type:'CORRECT_REASON',reason:value});await analyze();}}
 if(action==='dismiss-reflection'||action==='dismiss-correction'){correcting=false;state.evidence=null;state.route='general';state.analysisStatus='dismissed';render();focusStage();}
 if(action==='review-transfer')advance({type:'REVIEW_TRANSFER'});
 if(action==='retry-transfer'){controller?.abort();controller=null;busy=false;state.stage='transfer_review';state.feedback=null;await analyzeTransfer();}
 if(action==='skip-transfer'){controller?.abort();controller=null;busy=false;advance({type:'TRANSFER_FEEDBACK',feedback:{status:'skipped',strengths:[],additions:[]}});}
 if(action==='restart'){controller?.abort();controller=null;busy=false;correcting=false;state=freshJourney();if(save)saveCheckpoint(storage,checkpointVersion(),'decision');render();focusStage();}
 if(action==='next'&&nextTopic())await selectTopic(nextTopic().id,{focus:true});
}
async function analyze(){
 if(!aiConfig?.configured){advance({type:'ANALYSIS',route:'general',status:aiConfig?'not_configured':'unavailable'});return;}
 if(busy)return;busy=true;controller=new AbortController();const current=controller,ticket=lessonTicket;render();
 try{
  const response=await fetch('/api/reflect',{method:'POST',headers:{'Content-Type':'application/json','X-Qabas-Request':'1'},body:JSON.stringify({topicId:content.topic.id,initial:state.initial,revised:state.revised}),signal:current.signal});
  if(!response.ok)throw Error();const data=await response.json();if(controller!==current||ticket!==lessonTicket)return;
  if(!Object.keys(refs.followups).includes(data.route)||typeof data.status!=='string'||typeof data.evidence!=='string')throw Error();
  if(data.status==='ok'&&(!data.evidence.trim()||data.evidence.length>120||!state.revised.reason.includes(data.evidence)))throw Error();
  busy=false;advance({type:'ANALYSIS',route:data.route,status:data.status,evidence:data.evidence});
 }catch{if(controller!==current||ticket!==lessonTicket||current.signal.aborted)return;busy=false;advance({type:'ANALYSIS',route:'general',status:'unavailable'});}
}
async function analyzeTransfer(){
 const finish=feedback=>advance({type:'TRANSFER_FEEDBACK',feedback});
 if(!aiConfig?.configured){finish({status:aiConfig?'not_configured':'unavailable',strengths:[],additions:[]});return;}
 if(busy)return;busy=true;controller=new AbortController();const current=controller,ticket=lessonTicket;render();
 try{
  const response=await fetch('/api/transfer-feedback',{method:'POST',headers:{'Content-Type':'application/json','X-Qabas-Request':'1'},body:JSON.stringify({topicId:content.topic.id,answer:state.transferAnswer}),signal:current.signal});
  if(controller!==current||ticket!==lessonTicket)return;
  if(response.status===429){busy=false;finish({status:'busy',strengths:[],additions:[]});return;}
  if(!response.ok)throw Error();const data=await response.json();if(controller!==current||ticket!==lessonTicket)return;
  if(!validFeedback(data,Object.keys(refs.transferFeedback.criteria),state.transferAnswer)){busy=false;finish({status:'invalid',strengths:[],additions:[]});return;}
  busy=false;finish(data);
 }catch{if(controller!==current||ticket!==lessonTicket||current.signal.aborted)return;busy=false;finish({status:'unavailable',strengths:[],additions:[]});}
}
async function selectTopic(id,{focus=false}={}){
 if(!catalog.topics.some(t=>t.id===id&&t.journeyStatus==='available'))return;
 const ticket=++lessonTicket;controller?.abort();controller=null;busy=false;correcting=false;
 stage.innerHTML='<p class="status" role="status">جار تجهيز الموقف…</p>';
 try{
  const response=await fetch(`./data/lessons/${id}.json`);if(!response.ok)throw Error();const loaded=await response.json();if(ticket!==lessonTicket)return;
  if(loaded.topic?.id!==id||!Array.isArray(loaded.records))throw Error();
  content=loaded;records=Object.fromEntries(content.records.map(r=>[r.id,r]));refs=content.topic.refs;state=freshJourney();
  document.querySelector('#journey-value').textContent=content.topic.value;
  document.querySelector('#chapter-title').textContent=content.topic.value;
  document.querySelector('#chapter-number').textContent=String(catalog.topics.findIndex(t=>t.id===id)+1).padStart(2,'0').replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[d]);
  document.querySelectorAll('[data-topic]').forEach(b=>{if(b.dataset.topic===id)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});
  const url=new URL(location.href);url.searchParams.set('topic',id);history.replaceState(null,'',url);
  save=save||!!readCheckpoint(storage,checkpointVersion());document.querySelector('#save-progress').checked=save;
  document.querySelector('#save-note').textContent=save?'حفظ المرحلة لا يحفظ الإجابات؛ تبدأ الرحلة من جديد بعد إعادة التحميل.':'';
  render();if(focus){document.querySelector('.topic-menu').open=false;focusStage();}
 }catch{if(ticket===lessonTicket)stage.innerHTML='<h2>تعذر تحميل الموقف</h2><p>حاول إعادة تحميل الصفحة.</p>';}
}
stage.addEventListener('click',ev=>{const b=ev.target.closest('[data-action]');if(b&&!b.closest('form')){ev.preventDefault();handle(b.dataset.action);}});
document.querySelector('#topic-list').addEventListener('click',ev=>{const b=ev.target.closest('[data-topic]');if(b)selectTopic(b.dataset.topic,{focus:true});});
const dialog=document.querySelector('#info-dialog');
document.querySelector('#about-btn').addEventListener('click',()=>{
 const about=catalog?.about;
 if(!about){document.querySelector('#dialog-content').innerHTML='<h2>عن قبس</h2><p>جار تجهيز المعلومات؛ لنحاول بعد لحظة.</p>';dialog.showModal();return;}
 const paragraphs=keys=>keys.filter(k=>typeof about[k]==='string'&&about[k].trim()).map(k=>`<p>${e(about[k])}</p>`).join('');
 const provider=aiConfig?.provider==='groq'?'تعالج خدمة Groq الاختيار وسببه وإجابة موقف التطبيق خارج الجهاز باستخدام نموذج GPT‑OSS 120B.':aiConfig?.provider==='local'?'تتم معالجة الاختيار وسببه وإجابة موقف التطبيق محليا على خادم قبس.':'تعذر التحقق من إعداد خدمة التحليل حاليا.';
 document.querySelector('#dialog-content').innerHTML=`<h2>عن قبس</h2><h3>ما هو قبس؟</h3><p>${e(aboutBody)}</p><h3>دور الذكاء الاصطناعي والخصوصية</h3>${paragraphs(['aiRole','aiReview','aiLimits'])}<p>${e(provider)}</p>${paragraphs(['privacy','hostingDisclosure'])}<h3>المحتوى والمصادر</h3>${paragraphs(['sourcesBody'])}<p>${e(about.referencesLabel)}</p><ul class="about-references">${about.references.map(r=>`<li><a href="${e(r.url)}" target="_blank" rel="noopener noreferrer">${e(r.label)}</a></li>`).join('')}</ul><label class="save-toggle"><input type="checkbox" id="dialog-save"> تذكر مرحلتي على هذا الجهاز</label><button class="text-button" id="dialog-clear">مسح المرحلة المحفوظة</button>`;
 document.querySelector('#dialog-save').checked=save;document.querySelector('#dialog-save').addEventListener('change',ev=>setSave(ev.target.checked));document.querySelector('#dialog-clear').addEventListener('click',()=>{clearSave();document.querySelector('#dialog-save').checked=false;});dialog.showModal();
});
document.querySelector('.close-dialog').onclick=()=>dialog.close();
function clearSave(){try{storage.removeItem('qabas-checkpoint-v2');}catch{}save=false;document.querySelector('#save-progress').checked=false;document.querySelector('#save-note').textContent='مسحت المرحلة المحفوظة.';}
function setSave(value){if(!content||!state)return;save=value;document.querySelector('#save-progress').checked=value;if(!value){clearSave();return;}document.querySelector('#save-note').textContent=saveCheckpoint(storage,checkpointVersion(),state.stage)?'يحفظ اسم المرحلة فقط.':'تعذر الحفظ.';}
document.querySelector('#save-progress').onchange=ev=>setSave(ev.target.checked);
document.querySelector('#clear-progress').onclick=clearSave;
try{
 const configPromise=fetch('/api/config').then(r=>{if(!r.ok)throw Error();return r.json();}).then(c=>{if(!['local','groq'].includes(c.provider)||!['local','learning'].includes(c.scope)||typeof c.configured!=='boolean'||typeof c.model!=='string'||(c.provider==='groq')!==(c.scope==='learning'))throw Error();return c;}).catch(()=>null);
 const responses=await Promise.all([fetch('./data/catalog.json'),fetch('./data/content.json')]);if(responses.some(r=>!r.ok))throw Error();
 const [loadedCatalog,globalContent]=await Promise.all(responses.map(r=>r.json()));catalog=loadedCatalog;aboutBody=globalContent.records.find(r=>r.id==='about.what.body')?.text||aboutBody;aiConfig=await configPromise;
 document.querySelector('#topic-list').innerHTML=catalog.topics.map(t=>`<div role="listitem"><button class="topic-item" data-topic="${e(t.id)}"><span class="topic-copy"><span>${e(t.title)}</span><span class="topic-description">${e(t.description||'')}</span></span></button></div>`).join('');
 if(catalog.humanSupport?.url==='https://alifta.gov.sa/'){
  const support=catalog.humanSupport,footer=document.querySelector('.main-footer');
  footer.insertAdjacentHTML('beforebegin',`<details class="human-support"><summary>${e(support.title)}</summary><p>${e(support.body)}</p><a href="${e(support.url)}" target="_blank" rel="noopener noreferrer">${e(support.label)}</a><p class="assessment-note">يفتح موقعا خارجيا دون إرسال إجابتك إليه.</p></details>`);
 }
 const requested=new URL(location.href).searchParams.get('topic');await selectTopic(catalog.topics.some(t=>t.id===requested)?requested:catalog.topics[0].id);
}catch{stage.innerHTML='<h2>تعذر تحميل القصة</h2><p>حاول إعادة تحميل الصفحة.</p>';}
