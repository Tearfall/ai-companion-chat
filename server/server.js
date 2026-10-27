require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');
const { getReply, summarizeConversation } = require('./groq');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

    db.addMessage(persona.id, 'user', message);

    const history = db.getRecentMessages(persona.id, db.KEEP_RECENT);
    const { reply, moodDelta } = await getReply({
      name: persona.name,
      persona: persona.persona,
      mood: persona.mood,
      memorySummary: persona.memory_summary,
      history,
    });

    db.addMessage(persona.id, 'assistant', reply);
    const mood = db.adjustMood(persona.id, moodDelta);

    maybeFoldMemory(persona).catch((err) =>
      console.error('memory summarization failed:', err)
    );

    res.json({ reply, mood });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'failed to get a reply' });
  }
});

async function maybeFoldMemory(persona) {
  const total = db.countMessages(persona.id);
  if (total < db.SUMMARY_THRESHOLD) return;

  const toFold = db.getOldestUnsummarized(persona.id);
  if (!toFold.length) return;

  const summary = await summarizeConversation({
    name: persona.name,
    previousSummary: persona.memory_summary,
    messagesToFold: toFold,
  });

  db.setMemorySummary(persona.id, summary);
  db.deleteMessagesById(toFold.map((m) => m.id));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI companion chat running at http://localhost:${PORT}`);
});
