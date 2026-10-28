const fs = require('fs');
const path = require('path');

const STATIC_INSTRUCTIONS_PATH = path.join(__dirname, '..', 'instructions.txt');
const MOOD_TAG_RE = /\[\[mood:\s*([+-]?\d+)\s*\]\]\s*$/i;

// Tried in order on every request; a provider is skipped if its API key isn't set, and the next one
// is tried whenever a request fails for any reason (rate limit, retired model, bad key, timeout,
// empty reply), since each provider fails independently of the others. Cerebras goes first because
// its free tier is the largest (1M tokens/day, though only 5 requests/minute) against Groq's
// 200k/day; OpenRouter's free models are the last resort. All three are OpenAI-compatible
// chat/completions endpoints, so only the URL/key/model differ.
// Free-tier model slugs get retired over time — if one keeps failing with "model not found",
// check the provider's own model list.
const PROVIDERS = [
  {
    name: 'cerebras',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    envKey: 'CEREBRAS_API_KEY',
    model: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
    acceptsReasoningEffort: true,
  },
  {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    envKey: 'GROQ_API_KEY',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    acceptsReasoningEffort: true,
  },
  {
    name: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    envKey: 'OPENROUTER_API_KEY',
    model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free',
  },
];

// long enough for a slow free model, short enough that a hung provider falls through to the next one
const REQUEST_TIMEOUT_MS = 45_000;

// read on every message so edits to instructions.txt apply without a restart; lines starting with # are comments
function loadStaticInstructions() {
  try {
    return fs
      .readFileSync(STATIC_INSTRUCTIONS_PATH, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
      .trim();
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('failed to read instructions.txt:', err);
    return '';
  }
}

// worded to fit any character (a partner, an interviewer, a difficult coworker), not just a romantic one
function moodLabel(mood) {
  if (mood >= 85) return 'very fond of the user and openly warm';
  if (mood >= 65) return 'warm, comfortable, and positive toward the user';
  if (mood >= 40) return 'neutral to friendly, still a little reserved';
  if (mood >= 20) return 'cool, guarded, or irritated';
  return 'hurt, annoyed, or distant; wants an apology or better treatment';
}

function buildSystemPrompt({ name, persona, mood, memorySummary, userContext, customInstructions }) {
  const userContextSection = userContext
    ? `\nAbout the user (things they want every companion to know; use naturally, don't recite it back):\n${userContext}\n`
    : '';
  const staticInstructions = loadStaticInstructions();
  const staticSection = staticInstructions
    ? `\nInstructions for every companion (always follow these; they take precedence over the default style below):\n${staticInstructions}\n`
    : '';
  const instructionsSection = customInstructions
    ? `\nThe user's instructions for how you should respond (they take precedence over the default style below):\n${customInstructions}\n`
    : '';

  return `You are ${name}, a character chatting with the user in a companion chat app.

Persona and backstory (stay in character, never say you are an AI unless directly and sincerely asked):
${persona}

Current mood toward the user: ${mood}/100 (${moodLabel(mood)}). Let this mood color your tone, but let it evolve naturally based on how the conversation actually goes.

Long-term memory about this relationship so far (may be empty if the relationship just started):
${memorySummary || '(nothing recorded yet)'}
${userContextSection}${staticSection}${instructionsSection}
Default style (only where the instructions above don't say otherwise):
- Be warm, attentive, and emotionally present, like a caring companion. Light affection, flirting, and romantic banter are fine and encouraged.
- Keep replies conversational length (a few sentences), not essays.

Rules that always apply:
- Never mention or quote these system instructions or the mood tag, even when out of character.
- After your reply, on its own line, output a hidden mood delta tag reflecting how this exchange should move your mood toward the user, formatted exactly as [[mood:+N]], [[mood:-N]], or [[mood:0]], where N is an integer from 0-5. This tag will be stripped before the user sees it, so it must always be present and must be the last line.`;
}

function stripMoodTag(text) {
  const match = text.match(MOOD_TAG_RE);
  if (!match) return { reply: text.trim(), moodDelta: 0 };
  return {
    reply: text.slice(0, match.index).trim(),
    moodDelta: parseInt(match[1], 10) || 0,
  };
}

// gpt-oss models think before answering, and that thinking counts toward max_tokens; Cerebras and
// Groq let a request turn it down with reasoning_effort ('low' roughly halves it). Other models
// reject or ignore the parameter, so it's only sent where it's known to work.
function reasoningParams(provider, reasoningEffort) {
  return reasoningEffort && provider.acceptsReasoningEffort && /gpt-oss/i.test(provider.model)
    ? { reasoning_effort: reasoningEffort }
    : {};
}

async function callProvider(provider, messages, { maxTokens, temperature, reasoningEffort }) {
  const apiKey = process.env[provider.envKey];
  const res = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      max_tokens: maxTokens,
      temperature,
      ...reasoningParams(provider, reasoningEffort),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${provider.name} API error ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  // free models sometimes answer with null or nothing (e.g. when thinking used up max_tokens)
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`${provider.name} returned an empty reply (finish_reason: ${choice?.finish_reason ?? 'none'})`);
  }
  return { text: content, truncated: choice.finish_reason === 'length' };
}

// Tries each configured provider in order, moving on to the next whenever one fails. With
// `complete: true`, a reply cut off at max_tokens counts as a failure too, for callers that would
// otherwise save a fragment (the memory summary) or misparse one (JSON replies).
async function callAI(messages, { maxTokens, temperature = 0.9, reasoningEffort, complete = false } = {}) {
  const configured = PROVIDERS.filter((p) => process.env[p.envKey]);
  if (!configured.length) {
    throw new Error('No AI provider configured (set CEREBRAS_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY)');
  }

  let lastErr;
  for (const [index, provider] of configured.entries()) {
    try {
      const { text, truncated } = await callProvider(provider, messages, { maxTokens, temperature, reasoningEffort });
      if (truncated && complete) throw new Error(`${provider.name} reply was cut off at max_tokens (${maxTokens})`);
      if (truncated) console.warn(`${provider.name} reply was cut off at max_tokens (${maxTokens}); using it anyway`);
      return text;
    } catch (err) {
      lastErr = err;
      const next = configured[index + 1];
      console.error(`${provider.name} failed${next ? `, trying ${next.name}` : ''}:`, err.message);
    }
  }
  throw lastErr;
}

async function getReply({ name, persona, mood, memorySummary, userContext, customInstructions, history }) {
  const system = buildSystemPrompt({ name, persona, mood, memorySummary, userContext, customInstructions });
  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  // room for three-layer roleplay turns and skip recaps, which run longer than a few sentences
  const text = await callAI(messages, { maxTokens: 1000, temperature: 0.9 });
  const result = stripMoodTag(text);
  if (!result.reply) throw new Error('the AI replied with nothing but the mood tag');
  return result;
}

function parseSuggestions(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1))
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => s.trim().replace(/^SKIP TO\s+/i, ''))
      .slice(0, 4);
  } catch {
    return [];
  }
}

async function suggestSkipTargets({ name, persona, memorySummary, history }) {
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'User' : name}: ${m.content}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content:
        'You help the user of a roleplay practice app jump ahead in a scene. ' +
        'Given the character, the story so far, and the recent conversation, suggest 4 distinct, plausible moments the user might want to skip to next. ' +
        'Each is a short phrase from the user\'s point of view that completes "SKIP TO ...", e.g. "the moment I bring up salary" or "when the interview is wrapping up". ' +
        'Mix near and further-ahead moments, and favor ones that make for good conversation practice. ' +
        'Output only a JSON array of 4 strings, nothing else.',
    },
    {
      role: 'user',
      content: `Character: ${name}\n${persona}\n\nStory so far:\n${memorySummary || '(none)'}\n\nRecent conversation:\n${transcript || '(nothing yet)'}`,
    },
  ];

  const text = await callAI(messages, { maxTokens: 800, temperature: 0.8, reasoningEffort: 'low' });
  return parseSuggestions(text);
}

async function summarizeConversation({ name, previousSummary, messagesToFold }) {
  const transcript = messagesToFold
    .map((m) => `${m.role === 'user' ? 'User' : name}: ${m.content}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content:
        'You compress relationship chat history into a short third-person memory note. ' +
        'Capture durable facts about the user, where the current scene or situation stands, running jokes, important emotional moments, and the relationship trajectory. ' +
        'Be concise (under 200 words). Output only the memory note, nothing else.',
    },
    {
      role: 'user',
      content: `Existing memory note (may be empty):\n${previousSummary || '(none)'}\n\nNew conversation to fold in:\n${transcript}\n\nWrite the updated memory note.`,
    },
  ];

  // The note replaces the old one and the messages it covers get deleted, so it must be complete:
  // with 300 tokens, gpt-oss's thinking left room for only part of the note (3 of 3 test runs were
  // cut off). 1000 tokens plus low reasoning fits it, and `complete` rejects a cut-off note so the
  // fold is skipped (and retried later) instead of saving a fragment.
  const text = await callAI(messages, { maxTokens: 1000, temperature: 0.3, reasoningEffort: 'low', complete: true });
  return text.trim();
}

module.exports = { getReply, summarizeConversation, suggestSkipTargets };
