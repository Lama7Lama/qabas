import {boundedJson} from './model-response.mjs';
import {payloadHasContactData} from './privacy.mjs';
// Server-side synthetic evaluation only. This module is not wired to the website.
export const MODEL = 'gemini-3.8-flash';
export const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const discard = async response => { try { await response.body?.cancel(); } catch {} };
function usageOf(value) {
  const usage = {};
  for (const name of ['promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'totalTokenCount']) {
    if (Number.isSafeInteger(value?.[name]) && value[name] >= 0) usage[name] = value[name];
  }
  return usage;
}
function quotaOf(data) {
  const details = data?.error?.details;
  if (!Array.isArray(details)) return {};
  const result = {};
  const retry = details.find(d => d?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo')?.retryDelay;
  if (typeof retry === 'string' && /^\d+(?:\.\d+)?s$/.test(retry)) result.retry_after_seconds = Number(retry.slice(0, -1));
  const violations = details.find(d => d?.['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure')?.violations;
  if (Array.isArray(violations)) {
    result.quota = violations.slice(0, 10).map(v => Object.fromEntries(
      ['quotaMetric', 'quotaId', 'quotaValue'].filter(k => typeof v?.[k] === 'string' && /^[a-zA-Z0-9_./-]{1,160}$/.test(v[k])).map(k => [k, v[k]])
    ));
  }
  return result;
}
export function createGeminiEvaluationClient({prepare, apiKey = process.env.GEMINI_API_KEY, fetchImpl = globalThis.fetch, timeoutMs = 45000, maxRequests = 60} = {}) {
  if (typeof prepare !== 'function') throw TypeError('Trusted lesson preparation is required');
  if (typeof fetchImpl !== 'function') throw TypeError('fetchImpl is required');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 60) throw RangeError('maxRequests must be 1..60');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw RangeError('timeoutMs must be 1..120000');
  let requests = 0, inFlight = false;
  return async function analyzeSynthetic(input, {synthetic = false, signal} = {}) {
    if (synthetic !== true) return {status: 'blocked_scope'};
    let prepared;
    try { prepared = prepare(input); } catch { return {status: 'invalid_input'}; }
    if (payloadHasContactData(prepared.payload)) return {status: 'blocked_privacy'};
    if (typeof apiKey !== 'string' || !apiKey.trim()) return {status: 'not_configured'};
    if (signal?.aborted) return {status: 'unavailable', reason: 'cancelled_or_timeout'};
    if (inFlight) return {status: 'busy'};
    if (requests >= maxRequests) return {status: 'budget_exhausted'};
    requests++;
    inFlight = true;
    const started = Date.now(), requestNumber = requests, controller = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const meta = () => ({model: MODEL, request_number: requestNumber, latency_ms: Date.now() - started});
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: combinedSignal,
        headers: {'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim()},
        body: JSON.stringify({
          systemInstruction: {parts: [{text: prepared.policy}]},
          contents: [{role: 'user', parts: [{text: JSON.stringify(prepared.payload)}]}],
          generationConfig: {temperature: 0, maxOutputTokens: prepared.maxCompletionTokens || 1024,
            thinkingConfig: {thinkingLevel: 'LOW', includeThoughts: false},
            responseFormat: {text: {mimeType: 'APPLICATION_JSON', schema: prepared.schema}}}
        })
      });
      if (response.status === 429) {
        let quota = {};
        try { quota = quotaOf(await boundedJson(response)); } catch { await discard(response); }
        return {status: 'rate_limited', ...quota, ...meta()};
      }
      if (!response.ok) { await discard(response); return {status: 'unavailable', http_status: response.status, ...meta()}; }
      let data;
      try { data = await boundedJson(response); }
      catch { return {status: combinedSignal.aborted ? 'unavailable' : 'invalid', reason: combinedSignal.aborted ? 'cancelled_or_timeout' : 'invalid_response', ...meta()}; }
      if (combinedSignal.aborted) return {status: 'unavailable', reason: 'cancelled_or_timeout', ...meta()};
      const candidate = data?.candidates?.[0];
      if (candidate?.finishReason !== 'STOP' || data.promptFeedback?.blockReason || !Array.isArray(candidate?.content?.parts)) return {status: 'invalid', reason: 'incomplete_or_refused', ...meta()};
      const parts = candidate.content.parts.filter(p => p.thought !== true);
      if (!parts.length || parts.some(p => typeof p.text !== 'string')) return {status: 'invalid', reason: 'invalid_response', ...meta()};
      let parsed;
      try { parsed = JSON.parse(parts.map(p => p.text).join('')); } catch { return {status: 'invalid', reason: 'invalid_json', ...meta()}; }
      const analysis = prepared.normalize(parsed);
      if (!analysis) return {status: 'invalid', reason: 'invalid_output', ...meta()};
      return {status: 'classified', analysis, usage: usageOf(data.usageMetadata), ...meta()};
    } catch { return {status: 'unavailable', reason: combinedSignal.aborted ? 'cancelled_or_timeout' : 'network_error', ...meta()}; }
    finally { clearTimeout(timer); inFlight = false; }
  };
}
