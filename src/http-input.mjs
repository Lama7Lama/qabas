export async function readJSONBody(stream, maxBytes = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream.iterator({destroyOnReturn:false})) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      const error = new Error('Request too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  // Decode once: a network chunk may split the bytes of one Arabic character.
  const text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
  return JSON.parse(text);
}
