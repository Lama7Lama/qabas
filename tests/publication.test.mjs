import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationIssue} from '../src/publication.mjs';
const bytes=text=>Buffer.from(text);
test('publication refuses keys, private documents and secrets even in apparently safe source paths',()=>{
  for(const path of ['.env.local','.dev.vars','work/pilot/observations.csv','deliverables/deck.pptx','.git/config','source.map','notes.pdf','fonts/camel.otf'])assert.ok(publicationIssue(path,bytes('safe')));
  assert.ok(publicationIssue('src/safe.js',bytes('const example="'+('gsk_'+'A'.repeat(35))+'"')));
  assert.ok(publicationIssue('brand/logo.svg',bytes('<svg><script>run()</script></svg>')));
  assert.ok(publicationIssue('src/safe.js',bytes('unrecognized-secret-canary'),{secrets:['unrecognized-secret-canary']}));
  assert.equal(publicationIssue('.env.groq.example',bytes('GROQ_API_KEY=\n')),null);
  assert.ok(publicationIssue('.env.groq.example',bytes('GROQ_API_KEY=\n'),{target:'cloudflare'}));
  assert.equal(publicationIssue('src/safe.js',bytes('const enabled=true;')),null);
});
