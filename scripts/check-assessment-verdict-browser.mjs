import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {launchBrowser} from './browser-runtime.mjs';
const browser=await launchBrowser();
const access=process.env.QABAS_BROWSER_ACCESS_FILE?JSON.parse(await readFile(process.env.QABAS_BROWSER_ACCESS_FILE,'utf8')):null;
const base=access?.origin||'http://127.0.0.1:4173';
const page=await browser.newPage({viewport:{width:1365,height:1000},...(access?{httpCredentials:{username:'qabas',password:access.password}}:{})});page.setDefaultTimeout(15000);
const reasons=JSON.parse(await readFile('eval/six-lessons-development.json','utf8')).cases;
const answers=JSON.parse(await readFile('eval/personal-feedback-development.json','utf8')).cases;
const checks=[],errors=[],live=[];page.on('pageerror',err=>errors.push(err.message));
const action=name=>page.locator(`[data-action="${name}"]`);
const open=async topic=>{await page.goto(`${base}/?topic=${topic}`);await page.locator('#decision-form').waitFor();};
const revise=async f=>{await page.locator(`input[value="${f.choice}"]`).check();await page.locator('#reason').fill(f.reason);await action('decide').click();await page.locator('#reason').fill(f.reason);await action('revise').click();await page.locator('.source-card').waitFor();};
const transfer=async answer=>{await action('transfer').click();await page.locator('#reason').fill(answer);await action('finish').click();await page.getByRole('heading',{name:'ما الذي ظهر في تطبيقك للفكرة؟',exact:true}).waitFor();};
const mockReason=route=>{const input=route.request().postDataJSON();const f=reasons.find(x=>x.topicId===input.topicId&&x.expected!=='clarify');return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({route:f.expected,status:'ok',evidence:input.revised.reason.slice(0,100)})});};
const mockTransfer=route=>{const input=route.request().postDataJSON();assert.deepEqual(Object.keys(input).sort(),['answer','topicId']);const f=answers.find(x=>x.topicId===input.topicId);return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'ok',strengths:Object.keys(f.expected).map(criterion=>({criterion,evidence:input.answer.slice(0,100)})),additions:[]})});};
try{
 if(process.argv.includes('--simulate-config')){
  if(process.argv.includes('--live'))throw Error('Simulated configuration cannot be combined with live testing');
  await page.route('**/api/config',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({provider:'groq',model:'openai/gpt-oss-120b',scope:'learning',configured:true})}));
 }
 await mkdir('docs/qa',{recursive:true});await page.route('**/api/reflect',mockReason);await page.route('**/api/transfer-feedback',mockTransfer);
 for(const topicId of ['rifq','amanah','tathabbut','ghibah','namimah','hope_in_what_we_dislike']){
  await open(topicId);const reason=reasons.find(x=>x.topicId===topicId&&x.expected!=='clarify');await revise(reason);
  assert.ok((await page.locator('.ai-reflection').textContent()).includes('فهمت من عبارتك أنك'));
  assert.equal(await action('correct-understanding').textContent(),'هذا ما قصدته');
  assert.equal(await page.getByRole('heading',{name:'زاوية أخرى للتأمل'}).count(),1);
  assert.equal(await page.locator('#followup-form').count(),0);
  const answer=answers.find(x=>x.topicId===topicId).answer;await transfer(answer);
  assert.equal(await page.locator('.personal-feedback').count(),1);assert.equal(await page.locator('.optional-example[open]').count(),0);
  assert.equal(await page.locator('.personal-feedback .quote').count(),1);
  const example=page.locator('.optional-example');await example.locator('summary').click();assert.ok(await example.locator('p').isVisible());
  assert.equal(await action('next').count(),topicId==='hope_in_what_we_dislike'?0:1);checks.push(`${topicId}: reflection, optional angle, personal feedback, optional example and navigation`);
  if(topicId==='tathabbut'){await example.locator('summary').click();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'docs/qa/assessment-verdict-desktop.png',fullPage:true});checks.push('shared evidence displayed once for multiple comments');}
 }

 // Synthetic API replies verify verdict presentation, not semantic model accuracy.
 const setTransfer=async feedback=>{await page.unroute('**/api/transfer-feedback');await page.route('**/api/transfer-feedback',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(feedback)}));};
 const answer='أراجع موقع الجهة الرسمي وسنة المنحة وآخر موعد للتقديم';
 const tReason=reasons.find(x=>x.topicId==='tathabbut'&&x.expected!=='clarify');
 const gap={status:'ok',strengths:[{criterion:'source',evidence:'موقع الجهة الرسمي'},{criterion:'year',evidence:'سنة المنحة'}],additions:[{criterion:'deadline',kind:'not_shown',evidence:''}]};
 await setTransfer(gap);await open('tathabbut');await revise(tReason);await transfer(answer);
 assert.equal(await page.locator('.verdict.needs_addition').count(),1);assert.equal(await page.getByRole('heading',{name:'ما يمكنك إضافته',exact:true}).count(),1);assert.equal(await page.getByRole('heading',{name:'ما يحتاج تصحيحا',exact:true}).count(),0);checks.push('missing detail is an addition, never classified as an error');
 await setTransfer({status:'ok',strengths:[{criterion:'year',evidence:'سنة المنحة'}],additions:[{criterion:'source',kind:'opposed',evidence:'الشعار يكفي'},{criterion:'deadline',kind:'not_shown',evidence:''}]});
 await open('tathabbut');await revise(tReason);await transfer('الشعار يكفي، وأنا أعرف سنة المنحة');
 assert.equal(await page.locator('.verdict.needs_correction').count(),1);assert.equal(await page.locator('.verdict.appropriate').count(),0);assert.equal(await page.getByRole('heading',{name:'ما يحتاج تصحيحا',exact:true}).count(),1);assert.equal(await page.getByRole('heading',{name:'ما يمكنك إضافته',exact:true}).count(),1);checks.push('confirmed contradiction takes priority over strengths; corrections and additions have separate sections');
 await setTransfer({status:'ok',strengths:[{criterion:'source',evidence:'موقع الجهة الرسمي'}],additions:[]});await open('tathabbut');await revise(tReason);await transfer(answer);
 assert.equal(await page.locator('.verdict.partial').count(),1);assert.equal(await page.locator('.verdict.appropriate').count(),0);checks.push('withheld criteria prevent a complete positive verdict');
 await page.unroute('**/api/reflect');await page.route('**/api/reflect',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'unclear',route:'clarify',evidence:''})}));
 await open('tathabbut');await revise({...tReason,choice:'verify',reason:'كذا'});
 assert.equal(await page.locator('.choice-feedback .verdict.appropriate').count(),1);assert.equal(await page.locator('.ai-reflection').count(),0);assert.ok((await page.locator('.status').textContent()).includes('لم يتضح'));assert.ok((await page.locator('.choice-feedback').textContent()).includes('هذه ملاحظة على التصرف المختار'));checks.push('an appropriate choice does not imply that an unclear written reason was understood or correct');
 await open('rifq');await revise({...reasons[0],choice:'silence',reason:'كذا'});assert.equal(await page.locator('.choice-feedback .verdict.contextual').count(),1);assert.ok((await page.locator('.choice-feedback').textContent()).includes('ليس خطأ في ذاته'));checks.push('contextual silence is not labeled wrong');
 const support=page.locator('.human-support');await support.locator('summary').click();assert.equal(await support.locator('a').getAttribute('href'),'https://alifta.gov.sa/');assert.equal(await support.locator('a').getAttribute('rel'),'noopener noreferrer');assert.ok((await support.textContent()).includes('دون إرسال إجابتك'));checks.push('human referral opens an official site without answer parameters or referrer');
 await page.unroute('**/api/reflect');await page.route('**/api/reflect',mockReason);await page.unroute('**/api/transfer-feedback');await page.route('**/api/transfer-feedback',mockTransfer);
 await open('rifq');await revise(reasons[0]);await action('correct-understanding').click();await page.locator('#correction-form').waitFor();
 assert.equal(await page.getByRole('heading',{name:'ما فهمه النظام من سببك'}).count(),0);await page.locator('#reason').fill('أريد معالجة الخطأ بلطف مع حل عملي');await action('correct-reason').click();await page.locator('.ai-reflection .quote').waitFor();
 assert.ok((await page.locator('.ai-reflection .quote').textContent()).includes('أريد معالجة الخطأ'));assert.equal(await action('correct-understanding').count(),0);checks.push('disagreement hides old understanding and one correction is analyzed');
 await action('dismiss-reflection').click();assert.equal(await page.locator('.ai-reflection').count(),0);assert.equal(await page.locator('.source-card').count(),1);checks.push('corrected understanding can still be hidden without losing explanation');
 await page.unroute('**/api/transfer-feedback');await page.route('**/api/transfer-feedback',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'unclear',strengths:[],additions:[]})}));
 await transfer('كذا');await action('review-transfer').click();assert.ok((await page.locator('.prompt').textContent()).includes('ما الرد'));await page.locator('#reason').fill('أحتاج الجهاز وسأستخدم الهاتف');await action('finish').click();await page.getByRole('heading',{name:'ما الذي ظهر في تطبيقك للفكرة؟',exact:true}).waitFor();assert.equal(await action('review-transfer').count(),0);assert.equal(await page.locator('.personal-feedback').count(),0);checks.push('vague answer gets one optional tailored clarification, no praise and no loop');
 await page.unroute('**/api/transfer-feedback');await page.route('**/api/transfer-feedback',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'ok',strengths:[{criterion:'respect',evidence:'اقتباس مخترع'}],additions:[]})}));
 await open('rifq');await revise(reasons[0]);await transfer('إجابة افتراضية');assert.equal(await page.locator('.personal-feedback').count(),0);assert.ok((await page.locator('.status').textContent()).includes('لم تجتز'));checks.push('fabricated feedback quote rejected in browser without displaying claim');
 await page.unroute('**/api/transfer-feedback');await page.route('**/api/transfer-feedback',route=>route.fulfill({status:503,body:'{}',contentType:'application/json'}));
 await open('amanah');await revise(reasons.find(x=>x.topicId==='amanah'));await transfer('أعيدها لصاحبها');assert.equal(await action('retry-transfer').count(),1);assert.equal(await page.locator('.personal-feedback').count(),0);checks.push('service outage allows retry, example and next topic without invented personal feedback');
 await page.unroute('**/api/transfer-feedback');let held;await page.route('**/api/transfer-feedback',route=>{held=route;});
 await open('rifq');await revise(reasons[0]);await action('transfer').click();await page.locator('#reason').fill('أستخدم الهاتف');await action('finish').click();await action('skip-transfer').waitFor();await action('skip-transfer').click();
 try{await held.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'ok',strengths:[{criterion:'practical',evidence:'أستخدم الهاتف'}],additions:[]})});}catch{}
 assert.equal(await page.locator('.personal-feedback').count(),0);assert.ok((await page.locator('.status').textContent()).includes('دون تعليق'));checks.push('skip aborts pending analysis and stale feedback cannot replace completed journey');
 for(const status of ['rate_limited','privacy','outside','unverified']){
  await page.unroute('**/api/transfer-feedback');await page.route('**/api/transfer-feedback',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status,strengths:[],additions:[]})}));
  await open('tathabbut');await revise(reasons.find(x=>x.topicId==='tathabbut'));await transfer('أراجع المصدر');assert.equal(await page.locator('.personal-feedback').count(),0);assert.equal(await action('next').count(),1);assert.equal(await page.locator('.optional-example[open]').count(),0);if(status==='unverified')assert.ok(!(await page.locator('.status').textContent()).includes('لم تتضح'));checks.push(`${status}: no personal claim and journey remains navigable`);
 }
 await page.unroute('**/api/transfer-feedback');await page.route('**/api/transfer-feedback',route=>{held=route;});
 await open('rifq');await revise(reasons[0]);await action('transfer').click();await page.locator('#reason').fill('أستخدم الهاتف');await action('finish').click();await action('skip-transfer').waitFor();await page.locator('.topic-menu summary').click();await page.locator('[data-topic="amanah"]').click();await page.locator('#decision-form').waitFor();
 try{await held.fulfill({status:200,contentType:'application/json',body:JSON.stringify({status:'ok',strengths:[{criterion:'practical',evidence:'أستخدم الهاتف'}],additions:[]})});}catch{}
 assert.equal(await page.locator('#journey-value').textContent(),'الأمانة');assert.equal(await page.locator('#decision-form').count(),1);checks.push('switching topic aborts transfer feedback and late response cannot overwrite new lesson');
 await page.unroute('**/api/transfer-feedback');await page.route('**/api/transfer-feedback',mockTransfer);
 await page.setViewportSize({width:375,height:812});await open('tathabbut');await revise(reasons.find(x=>x.topicId==='tathabbut'));await transfer(answers.find(x=>x.id==='tathabbut-full').answer);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'docs/qa/assessment-verdict-mobile.png',fullPage:true});checks.push('personal feedback and collapsed example fit mobile width');
 await page.locator('#about-btn').click();
 const aboutText=await page.locator('#dialog-content').textContent();
 assert.ok(aboutText.includes('إجابة موقف التطبيق'));assert.ok(aboutText.includes('خارج الجهاز'));
 assert.ok(!aboutText.includes('راجع مختص الأدلة والمصادر'));assert.ok(!aboutText.includes('صاحبة المشروع'));
 assert.deepEqual(await page.locator('.about-references a').evaluateAll(links=>links.map(link=>link.href)),['https://dorar.net/hadith','https://quranpedia.net/','https://shamela.ws/']);
 await page.locator('#dialog-save').check();await page.locator('.close-dialog').click();
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('qabas-checkpoint-v2')));assert.deepEqual(Object.keys(stored).sort(),['stage','version']);assert.ok(!JSON.stringify(stored).includes('المنحة'));checks.push('disclosure covers both answers; checkpoint never contains text or feedback');
 await page.unroute('**/api/reflect');await page.unroute('**/api/transfer-feedback');
 if(process.argv.includes('--live')){
  await page.setViewportSize({width:1365,height:1000});await open('rifq');const initial=page.waitForResponse(r=>r.url().endsWith('/api/reflect'));await revise(reasons[0]);live.push({task:'reason',...await (await initial).json()});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/transfer-feedback'));await transfer(answers[0].answer);const feedback=await (await response).json();live.push({task:'transfer',...feedback});
  if(feedback.status==='ok'){assert.equal(await page.locator('.personal-feedback').count(),1);assert.ok(feedback.strengths.length>0);checks.push('real Groq classification and second audit reached personalized transfer through site');}
  else {assert.equal(await page.locator('.personal-feedback').count(),0);checks.push('real provider abstention or failure uses truthful fallback');}
  await page.screenshot({path:'docs/qa/assessment-verdict-live.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);checks.push('no browser JavaScript errors');
 await writeFile(`docs/assessment-verdict-browser${process.argv.includes('--live')?'-live':''}-check.json`,JSON.stringify({checkedAt:new Date().toISOString(),passed:true,checks,uiSha256:createHash('sha256').update(await readFile('src/web/app.js')).digest('hex'),simulatedFeedback:true,liveApiResponses:live,limitations:'UI mocks test rendering and safeguards, not model accuracy; live responses listed separately.'},null,2)+'\n');
 console.log(`${checks.length} browser checks passed; ${live.length} real endpoint responses.`);
}catch(error){await writeFile('docs/assessment-verdict-browser-failure.json',JSON.stringify({passed:false,checks,liveApiResponses:live,error:error.message},null,2));throw error;}finally{await browser.close();}
