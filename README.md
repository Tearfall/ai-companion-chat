# AI Companion Chat

A PWA companion chatbot: a chat UI with customizable, switchable personas, persistent
per-persona conversation memory, an avatar, and a mood/relationship meter. Powered by free AI
providers with automatic fallback.

## Setup

```bash
npm install
cp .env.example .env
python scripts/generate-icons.py
```

Edit `.env` and set at least one provider's API key — all are free, no card needed:
- `CEREBRAS_API_KEY` — cloud.cerebras.ai
- `GROQ_API_KEY` — console.groq.com
- `OPENROUTER_API_KEY` — openrouter.ai

Set more than one and the app tries them **in that order** on every request, moving on to the
next whenever one fails for any reason: rate limit, retired model, bad key, a 45-second timeout,
or an empty reply. See `server/ai.js`'s `PROVIDERS` list to reorder them or change models
(`*_MODEL` in `.env.example`). Free-tier model names get retired now and then; if the server log
keeps showing "model not found" for a provider, check its model list and update the `*_MODEL` line.

Free-tier limits as measured in October 2026 (each chat message is roughly 4,000–4,500 tokens,
about 1,500 of them from `instructions.txt`, so trimming that file stretches every limit):
- Cerebras `gpt-oss-120b`: 1M tokens/day (~230 messages), but only 5 requests/minute, 150/hour.
- Groq `openai/gpt-oss-120b`: 200k tokens/day (~47 messages), 8k tokens/minute.
- OpenRouter free models: a last resort; they're often rate-limited upstream.

*Skip to…* and memory summaries each make one extra AI call.

## Run

```bash
npm start
```

Then open http://localhost:3000. On a phone or in a desktop browser that supports it, you can
install it as an app via the browser's "Add to Home Screen" / install prompt.

## How it works

- **Personas** — create as many companions as you like, each with its own name, avatar, and
  personality/backstory blurb (becomes part of that persona's system prompt). Switch between
  them from the persona list screen; each persona keeps its own independent mood and memory.
- **Global instructions** — "Instructions for all companions" on the persona list screen has two
  fields that go into every persona's system prompt on every message: *About you* (facts you
  want every companion to know) and *How companions should respond* (style rules, like custom
  instructions in Claude/ChatGPT). They can't override the content guidelines.
- **Static instructions** — `instructions.txt` in the project root holds fixed instructions sent
  to every companion with every message, alongside the ones set in the app. Lines starting with
  `#` are ignored, and the file is re-read on each message, so edits apply without a restart.
  It currently turns every companion into an immersive roleplay communication trainer.
- **Session commands** — the button row above the chat input sends the commands defined in
  `instructions.txt` (Continue, Do something, Skip time, Skip scene, Skip to…, Recap) as your
  message. *Continue* lets the scene move on a few seconds when you have nothing to say. *Do
  something* narrates an action your character takes instead of something they say — it fills the
  chat input with `DO ` (also typeable directly, case-sensitive) so you only need to describe the
  action; the AI reacts to it in character, including embodied reactions (interjections, physical
  responses) rather than just describing the cause. Add quoted text to say something at the same
  time, e.g. `DO leans in and whispers, "I missed you"` — the quoted part is sent as a normal
  dialogue bubble right under the action, so you're not limited to the action alone. *Skip to…*
  asks the AI for a few likely moments to jump to, or takes your own.
- **Three-layer replies** — replies labeled `Scene/Action:` / `Inner Thoughts:` / `Dialogue:`
  render as three separate pieces instead of one bubble: narration renders centered with no
  bubble, dialogue renders in a normal chat bubble, and inner thoughts render as a 💭 caption
  left-aligned under the bubble. A `DO ` message you send renders the same way, except its
  narration is tinted with the theme's accent color instead of the muted gray the AI's own
  narration uses, so it's clear at a glance which one you wrote.
- **Memory** — all messages are stored per-persona in a local SQLite file (`data.sqlite`), and
  every not-yet-summarized message is sent with each request. Once a persona's conversation
  grows past ~40 messages, the oldest ones are folded into a running summary (via an AI call)
  so it remembers the relationship's history without the context window growing without bound.
- **Mood** — the model is asked to append a hidden `[[mood:+N]]` / `[[mood:-N]]` tag after each
  reply reflecting how that exchange affected the relationship; the server strips the tag,
  applies the delta to a 0–100 mood score per persona, and the UI shows it as a bar.
- **Avatar** — pick an emoji in the setup screen.
- **Offline/PWA** — installable with its own icon; a service worker caches the app shell and the
  persona list/chat history so the app opens instantly and past conversations are still viewable
  offline. Sending a new message still needs a connection and fails gracefully (with a visible
  banner) if you're offline.

## Notes

This is a single-user, local app (no auth, no multi-tenancy) — everything lives in one SQLite
file, and the "currently active persona" is remembered per-browser via localStorage. Delete
`data.sqlite` to wipe every persona and start over.
