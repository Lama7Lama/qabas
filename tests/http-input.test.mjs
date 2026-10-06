import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readJSONBody} from '../src/http-input.mjs';
test('Arabic survives network chunks split inside every multibyte character', async () => {
  const input = {topicId:'rifq',answer:'لنوضح الخطأ بهدوء 🙂'};
  const bytes = Buffer.from(JSON.stringify(input));
  assert.deepEqual(await readJSONBody(Readable.from([...bytes].map(byte=>Buffer.from([byte])))), input);
});
test('invalid UTF-8, invalid JSON and oversized requests are rejected', async () => {
  for(const bytes of [Buffer.from([0xff]),Buffer.from('{')])await assert.rejects(readJSONBody(Readable.from([bytes])));
  await assert.rejects(readJSONBody(Readable.from([Buffer.alloc(8193)])),error=>error.statusCode===413);
});
