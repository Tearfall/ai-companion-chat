# AI Companion Chat

A PWA companion chatbot: a chat UI with customizable, switchable personas, persistent
per-persona conversation memory, an avatar, and a mood/relationship meter. Powered by the free
Groq API.

## Setup

```bash
npm install
cp .env.example .env
python scripts/generate-icons.py
```

Edit `.env` and set `GROQ_API_KEY` to your Groq API key (free, no card needed — get one at
console.groq.com).

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
- **Memory** — all messages are stored per-persona in a local SQLite file (`data.sqlite`). Once
  a persona's conversation grows past ~40 messages, the oldest ones are folded into a running
  summary (via a Groq call) so it remembers the relationship's history without the context
  window growing without bound.
- **Mood** — the model is asked to append a hidden `[[mood:+N]]` / `[[mood:-N]]` tag after each
  reply reflecting how that exchange affected the relationship; the server strips the tag,
  applies the delta to a 0–100 mood score per persona, and the UI shows it as a bar.
- **Avatar** — pick an emoji in the setup screen, or pass an image URL as the avatar value via
  the API if you want a picture instead.
- **Offline/PWA** — installable with its own icon; a service worker caches the app shell and the
  persona list/chat history so the app opens instantly and past conversations are still viewable
  offline. Sending a new message still needs a connection and fails gracefully (with a visible
  banner) if you're offline.

The system prompt explicitly keeps romance PG-13 and disallows explicit sexual content.

## Notes

This is a single-user, local app (no auth, no multi-tenancy) — everything lives in one SQLite
file, and the "currently active persona" is remembered per-browser via localStorage. Delete
`data.sqlite` to wipe every persona and start over.
