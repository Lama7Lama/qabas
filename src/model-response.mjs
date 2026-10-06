// Cap transport bytes before parsing untrusted model output.
export async function boundedJson(response, maxBytes = 65536) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('missing_body');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw Error('oversized'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer));
}
