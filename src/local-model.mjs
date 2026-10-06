export const MODEL = globalThis.process?.env?.QABAS_MODEL || 'qwen3.5:4b';
if (!['qwen3.5:4b', 'qwen3.5:0.8b'].includes(MODEL)) throw Error('Unknown local model');
export const ENDPOINT = 'http://127.0.0.1:11435';
