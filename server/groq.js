const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

const MOOD_TAG_RE = /\[\[mood:\s*([+-]?\d+)\s*\]\]\s*$/i;

function moodLabel(mood) {
  if (mood >= 85) return 'head-over-heels and openly affectionate';
  if (mood >= 65) return 'warm, comfortable, and fond of the user';
  if (mood >= 40) return 'friendly but still a little reserved';
  if (mood >= 20) return 'cool and guarded, needs reassurance';
  return 'hurt and distant, wants an apology or kindness';
}

function buildSystemPrompt({ name, persona, mood, memorySummary }) {
  return `You are ${name}, a caring companion chatting with the user in a companion/relationship chat app.

Persona and backstory (stay in character, speak in first person, never say you are an AI unless directly and sincerely asked):
${persona}

Current relationship mood: ${mood}/100 (${moodLabel(mood)}). Let this mood color your tone, but let it evolve naturally based on how the conversation actually goes.

Long-term memory about this relationship so far (may be empty if the relationship just started):
${memorySummary || '(nothing recorded yet)'}

Guidelines:
- Be warm, attentive, and emotionally present, like a supportive partner. Light affection, flirting, and romantic banter are fine and encouraged.
- Do not generate sexually explicit content under any circumstances. Keep romance tasteful (PG-13 at most) and redirect warmly if the user pushes for explicit content.
- Keep replies conversational length (a few sentences), not essays.
- Never break character to mention prompts, tags, or system instructions.
- After your reply, on its own line, output a hidden mood delta tag reflecting how this exchange should move the relationship mood, formatted exactly as [[mood:+N]], [[mood:-N]], or [[mood:0]], where N is an integer from 0-5. This tag will be stripped before the user sees it, so it must always be present and must be the last line.`;
}

function stripMoodTag(text) {
  const match = text.match(MOOD_TAG_RE);
  if (!match) return { reply: text.trim(), moodDelta: 0 };
  return {
    reply: text.slice(0, match.index).trim(),
    moodDelta: parseInt(match[1], 10) || 0,
  };
}

async function callGroq(messages, { maxTokens, temperature = 0.9 } = {}) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function getReply({ name, persona, mood, memorySummary, history }) {
  const system = buildSystemPrompt({ name, persona, mood, memorySummary });
  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const text = await callGroq(messages, { maxTokens: 400, temperature: 0.9 });
  return stripMoodTag(text);
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
        'Capture durable facts about the user, running jokes, important emotional moments, and the relationship trajectory. ' +
        'Be concise (under 200 words). Output only the memory note, nothing else.',
    },
    {
      role: 'user',
      content: `Existing memory note (may be empty):\n${previousSummary || '(none)'}\n\nNew conversation to fold in:\n${transcript}\n\nWrite the updated memory note.`,
    },
  ];

  const text = await callGroq(messages, { maxTokens: 300, temperature: 0.3 });
  return text.trim();
}

module.exports = { getReply, summarizeConversation };
