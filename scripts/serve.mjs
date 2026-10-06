import {createLessonAIService} from '../src/lesson-ai.mjs';
import {createPreviewServer} from '../src/http-app.mjs';
const port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
const learning=await createLessonAIService(),origin=`http://127.0.0.1:${port}`;
const server=createPreviewServer({learning,origin});
server.listen(port,'127.0.0.1',()=>console.log(`قبس: ${origin} · ${learning.config.provider} · ${learning.config.configured?'configured':'not configured'}`));
