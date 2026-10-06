// Protected judging preview behind an HTTPS reverse proxy; not a public release.
import {createLessonAIService} from '../src/lesson-ai.mjs';
import {createPreviewServer} from '../src/http-app.mjs';
const port=Number(process.env.PORT||10000);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
const origin=process.env.QABAS_PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL;
if(!origin)throw Error('QABAS_PUBLIC_ORIGIN is required');
if(!process.env.GROQ_API_KEY?.trim())throw Error('A server-side Groq key is required');
const learning=await createLessonAIService({provider:'groq'});
const server=createPreviewServer({learning,origin,root:'dist/review',review:true,reviewPassword:process.env.QABAS_REVIEW_PASSWORD});
server.listen(port,'0.0.0.0',()=>console.log('Qabas protected review is listening. No credentials or answers logged.'));
