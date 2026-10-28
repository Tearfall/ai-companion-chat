require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');
const { getReply, summarizeConversation } = require('./ai');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/settings', (req, res) => {
  res.json({ settings: db.getSettings() });
});

app.put('/api/settings', (req, res) => {
  const { custom_instructions, user_context } = req.body;
  res.json({ settings: db.updateSettings({ custom_instructions, user_context }) });
});

app.get('/api/personas', (req, res) => {
  res.json({ personas: db.listPersonas() });
});

app.post('/api/personas', (req, res) => {
  const { name, persona, avatar } = req.body;
  if (!name || !persona) {
    return res.status(400).json({ error: 'name and persona are required' });
  }
  res.status(201).json({ persona: db.createPersona({ name, persona, avatar }) });
});

app.get('/api/personas/:id', (req, res) => {
  const persona = db.getPersona(req.params.id);
  if (!persona) return res.status(404).json({ error: 'persona not found' });
  res.json({ persona });
});

app.put('/api/personas/:id', (req, res) => {
  const { name, persona, avatar } = req.body;
  const updated = db.updatePersona(req.params.id, { name, persona, avatar });
  if (!updated) return res.status(404).json({ error: 'persona not found' });
  res.json({ persona: updated });
});

app.post('/api/personas/:id/reset', (req, res) => {
  const persona = db.resetPersona(req.params.id);
  if (!persona) return res.status(404).json({ error: 'persona not found' });
  res.json({ persona });
});

app.delete('/api/personas/:id', (req, res) => {
  const deleted = db.deletePersona(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'persona not found' });
  res.status(204).end();
});

app.get('/api/personas/:id/messages', (req, res) => {
  const persona = db.getPersona(req.params.id);
  if (!persona) return res.status(404).json({ error: 'persona not found' });
  res.json({ messages: db.getAllMessages(persona.id) });
});

app.post('/api/personas/:id/chat', async (req, res) => {
  try {
    const persona = db.getPersona(req.params.id);
    if (!persona) return res.status(404).json({ error: 'persona not found' });

    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    // Send everything not yet folded into memory_summary, so no message falls between the two. The
    // new message is only stored once a reply comes back: when the AI fails, the client puts the
    // text back for a retry, and storing it up front would leave a duplicate in the history.
    const history = [...db.getRecentMessages(persona.id, db.SUMMARY_THRESHOLD), { role: 'user', content: message }];
    const settings = db.getSettings();
    const { reply, moodDelta } = await getReply({
      name: persona.name,
      persona: persona.persona,
      mood: persona.mood,
      memorySummary: persona.memory_summary,
      userContext: settings.user_context,
      customInstructions: settings.custom_instructions,
      history,
    });

    db.addMessage(persona.id, 'user', message);
    db.addMessage(persona.id, 'assistant', reply);
    const mood = db.adjustMood(persona.id, moodDelta);

    maybeFoldMemory(persona.id).catch((err) =>
      console.error('memory summarization failed (the messages stay and are retried next turn):', err.message)
    );

    res.json({ reply, mood });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to get a reply' });
  }
});

// A fold runs in the background after a reply and can take a while; without this, every message sent
// meanwhile would start another one over the same messages, extending an outdated memory note.
const foldsInProgress = new Set();

async function maybeFoldMemory(personaId) {
  if (foldsInProgress.has(personaId)) return;
  foldsInProgress.add(personaId);
  try {
    if (db.countMessages(personaId) < db.SUMMARY_THRESHOLD) return;

    const toFold = db.getOldestUnsummarized(personaId);
    const persona = db.getPersona(personaId); // read now, so the newest memory note is the one extended
    if (!toFold.length || !persona) return;

    // throws rather than returning a cut-off or empty note, which leaves the messages in place to be
    // folded on a later turn instead of being replaced by a fragment
    const summary = await summarizeConversation({
      name: persona.name,
      previousSummary: persona.memory_summary,
      messagesToFold: toFold,
    });

    db.foldMessages(personaId, summary, toFold.map((m) => m.id));
  } finally {
    foldsInProgress.delete(personaId);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI companion chat running at http://localhost:${PORT}`);
});
