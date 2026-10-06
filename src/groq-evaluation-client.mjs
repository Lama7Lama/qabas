import {boundedJson} from './model-response.mjs';
import {payloadHasContactData} from './privacy.mjs';
// Server-side transport shared by the learning journey and synthetic evaluations. Never bundle keys.
export const MODEL = 'openai/gpt-oss-120b';
export const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const discard = async response => { try { await response.body?.cancel(); } catch {} };
const retrySeconds = value => value && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;
function usageOf(value) {
  const usage = {};
  for (const name of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(value?.[name]) && value[name] >= 0) usage[name] = value[name];
  }
  return usage;
}
export function createGroqStructuredClient({prepare, apiKey = globalThis.process?.env?.GROQ_API_KEY, fetchImpl = globalThis.fetch, timeoutMs = 45000, maxRequests = 60} = {}) {
  if(typeof prepare!=='function')throw new TypeError('Trusted lesson preparation is required');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 60) throw new RangeError('maxRequests must be 1..60');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new RangeError('timeoutMs must be 1..120000');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  let requests = 0;
  let inFlight = false;
  return async function analyze(input, {signal} = {}) {
    let prepared;
    try{prepared=prepare(input);}catch{return {status:'invalid_input'};}
    const payload=prepared.payload;
    if (payloadHasContactData(payload)) return {status: 'blocked_privacy'};
    if (typeof apiKey !== 'string' || !apiKey.trim()) return {status: 'not_configured'};
    if (signal?.aborted) return {status: 'unavailable', reason: 'cancelled_or_timeout'};
    if (inFlight) return {status: 'busy'};
    if (requests >= maxRequests) return {status: 'budget_exhausted'};
    requests += 1;
    inFlight = true;
    const started = Date.now();
    const requestNumber = requests;
    const controller = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const meta = () => ({model: MODEL, request_number: requestNumber, latency_ms: Date.now() - started});
    try {
      const response = await fetchImpl(ENDPOINT, {
        // Workers rejects redirect:'error'. 'manual' preserves the same security
        // boundary: 3xx is rejected below, never followed with the API key.
        method: 'POST', redirect: 'manual', signal: combinedSignal,
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}`},
        body: JSON.stringify({model: MODEL, temperature: 0, reasoning_effort: 'low', max_completion_tokens: prepared.maxCompletionTokens||1024, stream: false,
          messages: [{role: 'system', content: prepared.policy}, {role: 'user', content: JSON.stringify(payload)}],
          response_format: {type: 'json_schema', json_schema: {name: 'reason_classification', strict: true, schema:prepared.schema}}})
      });
      if (response.status === 429) { await discard(response); return {status: 'rate_limited', retry_after_seconds: retrySeconds(response.headers.get('retry-after')), ...meta()}; }
      if (!response.ok) { await discard(response); return {status: 'unavailable', http_status: response.status, ...meta()}; }
      let data;
      try { data = await boundedJson(response); }
      catch { return {status: combinedSignal.aborted ? 'unavailable' : 'invalid', reason:combinedSignal.aborted?'cancelled_or_timeout':'invalid_response', ...meta()}; }
      if (combinedSignal.aborted) return {status: 'unavailable', reason: 'cancelled_or_timeout', ...meta()};
      const choice = data?.choices?.[0];
      if (choice?.finish_reason !== 'stop' || choice?.message?.refusal || typeof choice?.message?.content !== 'string') return {status: 'invalid', reason:'incomplete_or_refused', ...meta()};
      let parsed;
      try { parsed = JSON.parse(choice.message.content); } catch { return {status: 'invalid', reason:'invalid_json', ...meta()}; }
      const analysis=prepared.normalize(parsed);
      if (!analysis) return {status: 'invalid', reason:'invalid_output', ...meta()};
      return {status: 'classified', analysis, usage: usageOf(data.usage), ...meta()};
    } catch { return {status: 'unavailable', reason: combinedSignal.aborted ? 'cancelled_or_timeout' : 'network_error', ...meta()}; }
    finally { clearTimeout(timer); inFlight = false; }
  };
}
