import { CONFIG } from '../config.js';

/**
 * Provider-agnostic model wrapper with a hard timeout.
 *
 * Groq by default — the free tier removes the per-call cost anxiety that
 * otherwise pushes you into under-prompting the agents, and its latency is
 * well inside the tick budget. Anthropic is kept as a drop-in alternative
 * because the two differ only in wire format, and being locked to one vendor
 * on demo night is a risk with no upside.
 *
 * Everything is env-driven (LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL) so
 * swapping model or vendor never requires a code change.
 *
 * Latency discipline is the difference between a game that breathes and one
 * that stalls. All 8 agents deliberate in PARALLEL with a hard cap. An agent
 * that times out simply does nothing that tick — never let one slow call
 * stall the world, and never show the room a spinner longer than 2 seconds.
 */

const { PROVIDER, MODEL, BASE_URL, JSON_MODE } = CONFIG.AGENT;

function apiKey() {
  return PROVIDER === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY
    : process.env.GROQ_API_KEY;
}

export function providerStatus() {
  return {
    provider: PROVIDER,
    model: MODEL,
    keyPresent: Boolean(apiKey()),
    mock: CONFIG.MOCK_LLM,
  };
}

/**
 * One completion.
 *
 * @param {string}  system    system prompt
 * @param {string}  user      user turn
 * @param {number}  maxTokens hard output cap
 * @param {number}  timeoutMs abort budget
 * @param {boolean} json      ask the provider to guarantee parseable JSON
 */
export async function callModel({ system, user, maxTokens = 300, timeoutMs = 8000, json = false }) {
  const key = apiKey();
  if (!key) throw new Error(`No ${PROVIDER} API key — using fallback brain`);

  // AbortController rather than a dangling Promise.race: a raced-away fetch
  // keeps running and, with 8 agents a tick for 40 ticks, those add up into
  // rate-limit pressure for responses nobody will ever read.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    return PROVIDER === 'anthropic'
      ? await callAnthropic({ key, system, user, maxTokens, signal: ac.signal })
      : await callOpenAICompatible({ key, system, user, maxTokens, json, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Groq and anything else speaking the OpenAI chat-completions dialect.
 * Plain fetch — the wire format is three fields, and a dependency whose only
 * job is to build this object is a dependency that can break the build.
 */
async function callOpenAICompatible({ key, system, user, maxTokens, json, signal }) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  // Structured output turns a whole class of "the model wrapped it in prose"
  // parse failures into non-events. Not every model supports it, so a refusal
  // is retried unstructured rather than dropping the agent's whole turn.
  if (json && JSON_MODE) body.response_format = { type: 'json_object' };

  let res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok && body.response_format) {
    delete body.response_format;
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${PROVIDER} ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error(`${PROVIDER}: no content in response`);
  return text;
}

async function callAnthropic({ key, system, user, maxTokens, signal }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

/**
 * Run every agent's deliberation concurrently. Failures are swallowed
 * individually so one bad agent can't take down the tick.
 */
export async function deliberateAll(agents, runner) {
  const results = await Promise.allSettled(agents.map(a => runner(a)));
  return results.map((r, i) => ({
    agent: agents[i],
    actions: r.status === 'fulfilled' ? r.value : null,
    failed: r.status === 'rejected',
  }));
}
