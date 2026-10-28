const AVATAR_OPTIONS = ['🙂', '😊', '😉', '🥰', '😎', '🌙', '⭐', '🌸', '🦊', '🐱'];
const ACTIVE_PERSONA_KEY = 'activePersonaId';

const personaListScreen = document.getElementById('persona-list-screen');
const personaCardsEl = document.getElementById('persona-cards');
const newPersonaBtn = document.getElementById('new-persona-btn');
const settingsBtn = document.getElementById('settings-btn');

const settingsScreen = document.getElementById('settings-screen');
const userContextInput = document.getElementById('user-context-input');
const instructionsInput = document.getElementById('instructions-input');
const settingsSaveBtn = document.getElementById('settings-save-btn');
const settingsBackBtn = document.getElementById('settings-back-btn');
const settingsError = document.getElementById('settings-error');

const setupScreen = document.getElementById('setup-screen');
const setupTitle = document.getElementById('setup-title');
const avatarGrid = document.getElementById('avatar-grid');
const nameInput = document.getElementById('name-input');
const personaInput = document.getElementById('persona-input');
const saveBtn = document.getElementById('save-btn');
const backBtn = document.getElementById('back-btn');
const deleteBtn = document.getElementById('delete-btn');
const setupError = document.getElementById('setup-error');
const dangerZone = document.getElementById('danger-zone');
const resetBtn = document.getElementById('reset-btn');
const resetConfirm = document.getElementById('reset-confirm');
const resetCancelBtn = document.getElementById('reset-cancel-btn');
const resetConfirmBtn = document.getElementById('reset-confirm-btn');

const chatScreen = document.getElementById('chat-screen');
const switchPersonaBtn = document.getElementById('switch-persona-btn');
const editPersonaBtn = document.getElementById('edit-persona-btn');
const headerAvatar = document.getElementById('header-avatar');
const headerName = document.getElementById('header-name');
const moodBarFill = document.getElementById('mood-bar-fill');
const offlineBanner = document.getElementById('offline-banner');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const commandBar = document.getElementById('command-bar');
const skipToBtn = document.getElementById('skip-to-btn');
const skipToPanel = document.getElementById('skip-to-panel');
const skipToOptions = document.getElementById('skip-to-options');
const skipToClose = document.getElementById('skip-to-close');
const skipToForm = document.getElementById('skip-to-form');
const skipToInput = document.getElementById('skip-to-input');
const doBtn = document.getElementById('do-btn');
const undoLastTurnBtn = document.getElementById('undo-last-turn-btn');

// session commands (defined in instructions.txt), shown as a small chip instead of a user bubble
const COMMAND_LABELS = {
  CONTINUE: '▶ Continue',
  'SKIP TIME': '⏩ Skip time',
  'SKIP SCENE': '🎬 Skip scene',
  RECAP: '📝 Recap',
};

// a "DO <action>" message narrates what the user's character does, instead of says —
// rendered like narrative (centered, no bubble) rather than a dialogue bubble or command chip.
// Quoted text inside it ("...") is spoken dialogue said while doing the action, split out into
// its own bubble so a DO message can carry both an action and something said at the same time.
const DO_RE = /^DO\s+(.+)$/s;
const QUOTE_RE = /["“]([^"”]+)["”]/g;

function splitDoMessage(actionText) {
  const dialogue = [];
  const narrative = actionText
    .replace(QUOTE_RE, (_, inner) => {
      const trimmed = inner.trim();
      if (trimmed) dialogue.push(trimmed);
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { narrative, dialogue };
}

// labels for the three-layer roleplay format; anything before the first label (e.g. a skip recap) renders as plain text
const LAYER_RE = /^[^\p{L}]*(scene\s*\/\s*action|scene|action|inner\s+thoughts?|thoughts?|dialogue)[\s*_]*:[\s*_]*(.*)$/iu;

let selectedAvatar = AVATAR_OPTIONS[0];
let editingPersonaId = null; // null = create mode in setup screen
let activeChatPersona = null; // persona object currently shown in chat screen
let knownPersonaCount = 0;
let sending = false; // a chat request is in flight
let undoAvailable = false;
let skipToRequestId = 0; // ignores suggestion responses that arrive after the panel was closed or reopened

function hideAllScreens() {
  personaListScreen.classList.add('hidden');
  setupScreen.classList.add('hidden');
  settingsScreen.classList.add('hidden');
  chatScreen.classList.add('hidden');
}

function getActivePersonaId() {
  const raw = localStorage.getItem(ACTIVE_PERSONA_KEY);
  return raw ? Number(raw) : null;
}

function setActivePersonaId(id) {
  if (id == null) {
    localStorage.removeItem(ACTIVE_PERSONA_KEY);
  } else {
    localStorage.setItem(ACTIVE_PERSONA_KEY, String(id));
  }
}

function setAvatarEl(container, avatar) {
  container.innerHTML = '';
  if (/^https?:\/\//.test(avatar)) {
    const img = document.createElement('img');
    img.src = avatar;
    container.appendChild(img);
  } else {
    container.textContent = avatar;
  }
}

function renderAvatarGrid() {
  avatarGrid.innerHTML = '';
  AVATAR_OPTIONS.forEach((emoji) => {
    const el = document.createElement('div');
    el.className = 'avatar-option' + (emoji === selectedAvatar ? ' selected' : '');
    el.textContent = emoji;
    el.addEventListener('click', () => {
      selectedAvatar = emoji;
      renderAvatarGrid();
    });
    avatarGrid.appendChild(el);
  });
}

function commandLabel(text) {
  if (COMMAND_LABELS[text]) return COMMAND_LABELS[text];
  const skipTo = text.match(/^SKIP TO (.+)$/s);
  return skipTo ? `🎯 Skip to ${skipTo[1]}` : null;
}

function layerType(label) {
  const lower = label.toLowerCase();
  if (lower.startsWith('dialogue')) return 'dialogue';
  if (lower.includes('thought')) return 'thoughts';
  return 'scene';
}

function splitAssistantSections(text) {
  const sections = [];
  text.split(/\r?\n/).forEach((line) => {
    const match = line.match(LAYER_RE);
    if (match) {
      sections.push({ type: layerType(match[1]), lines: [match[2]] });
    } else if (sections.length) {
      sections[sections.length - 1].lines.push(line);
    } else {
      sections.push({ type: 'plain', lines: [line] });
    }
  });
  return sections;
}

function appendLayerEl(wrapper, className, content) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = content;
  wrapper.appendChild(el);
}

// Builds one assistant turn: narrative (Scene/Action + stray recap text) renders centered,
// dialogue renders as a normal bubble, inner thoughts render as a caption under the bubble.
function buildAssistantTurn(text) {
  const sections = splitAssistantSections(text);
  const wrapper = document.createElement('div');
  wrapper.className = 'assistant-turn';

  if (!sections.some((s) => s.type !== 'plain')) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble assistant';
    bubble.textContent = text;
    wrapper.appendChild(bubble);
    return wrapper;
  }

  const narrative = [];
  const dialogue = [];
  const thoughts = [];
  sections.forEach(({ type, lines }) => {
    const content = lines.join('\n').replace(/\*+/g, '').trim();
    if (!content) return;
    if (type === 'dialogue') dialogue.push(content);
    else if (type === 'thoughts') thoughts.push(content);
    else narrative.push(content); // 'scene' and stray 'plain' (e.g. skip recaps) both read as narration
  });

  narrative.forEach((content) => appendLayerEl(wrapper, 'layer-narrative', content));
  dialogue.forEach((content) => {
    const bubble = document.createElement('div');
    bubble.className = 'bubble assistant';
    bubble.textContent = content;
    wrapper.appendChild(bubble);
  });
  thoughts.forEach((content) => appendLayerEl(wrapper, 'layer-thought-caption', content));

  return wrapper;
}

function addAssistantTurn(text) {
  const turn = buildAssistantTurn(text);
  messagesEl.appendChild(turn);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return turn;
}

function addPendingBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'bubble assistant pending';
  bubble.textContent = '…';
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function addBubble(role, text) {
  const doMatch = role === 'user' ? text.match(DO_RE) : null;

  if (doMatch) {
    const { narrative, dialogue } = splitDoMessage(doMatch[1].trim());
    const wrapper = document.createElement('div');
    wrapper.className = 'user-turn';
    if (narrative) appendLayerEl(wrapper, 'layer-narrative user-narrative', narrative);
    dialogue.forEach((line) => {
      const bubble = document.createElement('div');
      bubble.className = 'bubble user';
      bubble.textContent = line;
      wrapper.appendChild(bubble);
    });
    if (!narrative && !dialogue.length) {
      // "DO" with nothing left after stripping quotes — fall back to showing it raw
      appendLayerEl(wrapper, 'layer-narrative user-narrative', text);
    }
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return wrapper;
  }

  const label = role === 'user' ? commandLabel(text) : null;
  const bubble = document.createElement('div');
  bubble.className = label ? 'command-chip' : `bubble ${role}`;
  bubble.textContent = label || text;
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function setMood(mood) {
  moodBarFill.style.width = `${Math.max(0, Math.min(100, mood))}%`;
}

async function fetchPersonas() {
  const res = await fetch('/api/personas');
  const { personas } = await res.json();
  return personas;
}

async function showPersonaList() {
  const personas = await fetchPersonas();
  knownPersonaCount = personas.length;
  showPersonaListScreen(personas);
}

function showPersonaListScreen(personas) {
  hideAllScreens();
  personaListScreen.classList.remove('hidden');
  personaCardsEl.innerHTML = '';
  personas.forEach((persona) => {
    const card = document.createElement('div');
    card.className = 'persona-card';

    const avatar = document.createElement('div');
    avatar.className = 'companion-avatar';
    setAvatarEl(avatar, persona.avatar);

    const info = document.createElement('div');
    info.className = 'persona-card-info';
    const name = document.createElement('div');
    name.className = 'companion-name';
    name.textContent = persona.name;
    const moodTrack = document.createElement('div');
    moodTrack.className = 'mood-bar-track';
    const moodFill = document.createElement('div');
    moodFill.className = 'mood-bar-fill';
    moodFill.style.width = `${Math.max(0, Math.min(100, persona.mood))}%`;
    moodTrack.appendChild(moodFill);
    info.appendChild(name);
    info.appendChild(moodTrack);

    const editIcon = document.createElement('button');
    editIcon.className = 'persona-card-edit';
    editIcon.textContent = '✎';
    editIcon.title = 'Edit persona';
    editIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      showSetupScreen(persona);
    });

    card.appendChild(avatar);
    card.appendChild(info);
    card.appendChild(editIcon);
    card.addEventListener('click', () => openChat(persona.id));
    personaCardsEl.appendChild(card);
  });
}

function showSetupScreen(persona) {
  hideAllScreens();
  setupScreen.classList.remove('hidden');
  editingPersonaId = persona ? persona.id : null;
  setupError.textContent = '';

  resetConfirm.classList.add('hidden');
  resetBtn.classList.remove('hidden');

  if (persona) {
    setupTitle.textContent = `Edit ${persona.name}`;
    nameInput.value = persona.name;
    personaInput.value = persona.persona;
    selectedAvatar = persona.avatar;
    saveBtn.textContent = 'Save changes';
    dangerZone.classList.remove('hidden');
  } else {
    setupTitle.textContent = 'Create your companion';
    nameInput.value = '';
    personaInput.value = '';
    selectedAvatar = AVATAR_OPTIONS[0];
    saveBtn.textContent = 'Start chatting';
    dangerZone.classList.add('hidden');
  }

  backBtn.classList.toggle('hidden', knownPersonaCount === 0);
  renderAvatarGrid();
  nameInput.focus();
}

async function showSettingsScreen() {
  hideAllScreens();
  settingsScreen.classList.remove('hidden');
  settingsError.textContent = '';

  try {
    const res = await fetch('/api/settings');
    const { settings } = await res.json();
    userContextInput.value = settings.user_context;
    instructionsInput.value = settings.custom_instructions;
  } catch (err) {
    settingsError.textContent = "Couldn't load your instructions.";
  }
  userContextInput.focus();
}

async function openChat(personaId) {
  const res = await fetch(`/api/personas/${personaId}`);
  if (!res.ok) {
    setActivePersonaId(null);
    return boot();
  }
  const { persona } = await res.json();
  setActivePersonaId(persona.id);
  await showChatScreen(persona);
}

async function showChatScreen(persona) {
  hideAllScreens();
  chatScreen.classList.remove('hidden');
  activeChatPersona = persona;
  headerName.textContent = persona.name;
  setAvatarEl(headerAvatar, persona.avatar);
  setMood(persona.mood);
  closeSkipToPanel();

  const res = await fetch(`/api/personas/${persona.id}/messages`);
  const { messages } = await res.json();
  renderMessages(messages);
  updateOfflineBanner();
  chatInput.focus();
}

function renderMessages(messages) {
  messagesEl.innerHTML = '';
  messages.forEach((m) => (m.role === 'assistant' ? addAssistantTurn(m.content) : addBubble(m.role, m.content)));
  messagesEl.scrollTop = messagesEl.scrollHeight;
  undoAvailable = messages.at(-1)?.role === 'user' ||
    (messages.at(-1)?.role === 'assistant' && messages.at(-2)?.role === 'user');
  undoLastTurnBtn.disabled = sending || !navigator.onLine || !undoAvailable;
}

function setComposerDisabled(disabled) {
  chatInput.disabled = disabled;
  chatForm.querySelector('button[type="submit"]').disabled = disabled;
  commandBar.querySelectorAll('button').forEach((btn) => {
    btn.disabled = disabled || (btn === undoLastTurnBtn && !undoAvailable);
  });
  skipToPanel.querySelectorAll('button, input').forEach((el) => (el.disabled = disabled));
}

function updateOfflineBanner() {
  const offline = !navigator.onLine;
  offlineBanner.classList.toggle('hidden', !offline);
  setComposerDisabled(offline || sending);
}

function closeSkipToPanel() {
  skipToRequestId++;
  skipToPanel.classList.add('hidden');
}

async function openSkipToPanel() {
  const requestId = ++skipToRequestId;
  const personaId = activeChatPersona.id;
  skipToPanel.classList.remove('hidden');
  skipToInput.value = '';
  skipToOptions.innerHTML = '';
  const status = document.createElement('p');
  status.className = 'skip-to-status';
  status.textContent = 'Thinking of moments to jump to…';
  skipToOptions.appendChild(status);

  try {
    const res = await fetch(`/api/personas/${personaId}/skip-suggestions`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get suggestions');
    if (requestId !== skipToRequestId) return;

    if (!data.suggestions.length) {
      status.textContent = 'No suggestions this time. Type your own below.';
      return;
    }
    skipToOptions.innerHTML = '';
    data.suggestions.forEach((situation) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'skip-to-option';
      option.textContent = situation;
      option.disabled = sending || !navigator.onLine;
      option.addEventListener('click', () => skipTo(situation));
      skipToOptions.appendChild(option);
    });
  } catch (err) {
    if (requestId === skipToRequestId) {
      status.textContent = "Couldn't get suggestions. Type your own below.";
    }
  }
}

function skipTo(situation) {
  closeSkipToPanel();
  sendMessage(`SKIP TO ${situation}`);
}

// Runs a request that should keep the composer locked until it's done and always unlocks it afterwards.
async function withComposerLocked(task) {
  sending = true;
  setComposerDisabled(true);
  try {
    await task();
  } finally {
    sending = false;
    setComposerDisabled(!navigator.onLine);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

async function sendMessage(text, { fromInput = false } = {}) {
  if (!activeChatPersona || sending) return;

  const persona = activeChatPersona;
  addBubble('user', text);
  const pending = addPendingBubble();

  await withComposerLocked(async () => {
    try {
      const res = await fetch(`/api/personas/${persona.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to get a reply');
      pending.replaceWith(buildAssistantTurn(data.reply));
      setMood(data.mood);
      undoAvailable = true;
    } catch (err) {
      pending.classList.remove('pending');
      pending.textContent = `Couldn't send that: ${err.message}`;
      if (fromInput) chatInput.value = text;
    }
  });
  chatInput.focus();
}

async function undoLastTurn() {
  if (!activeChatPersona || sending || !undoAvailable) return;

  const persona = activeChatPersona;
  await withComposerLocked(async () => {
    try {
      const res = await fetch(`/api/personas/${persona.id}/undo-last-turn`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to undo the last turn');
      renderMessages(data.messages);
      setMood(data.mood);
      chatInput.value = data.restoredMessage;
    } catch (err) {
      addBubble('assistant', `Couldn't undo the last turn: ${err.message}`);
    }
  });
  chatInput.focus();
}

async function boot() {
  const personas = await fetchPersonas();
  knownPersonaCount = personas.length;

  if (personas.length === 0) {
    showSetupScreen(null);
    return;
  }

  const activeId = getActivePersonaId();
  const active = activeId ? personas.find((p) => p.id === activeId) : null;
  if (active) {
    await showChatScreen(active);
  } else {
    showPersonaListScreen(personas);
  }
}

newPersonaBtn.addEventListener('click', () => showSetupScreen(null));

backBtn.addEventListener('click', showPersonaList);

switchPersonaBtn.addEventListener('click', showPersonaList);

editPersonaBtn.addEventListener('click', () => {
  if (activeChatPersona) showSetupScreen(activeChatPersona);
});

settingsBtn.addEventListener('click', showSettingsScreen);

settingsBackBtn.addEventListener('click', showPersonaList);

settingsSaveBtn.addEventListener('click', async () => {
  settingsSaveBtn.disabled = true;
  settingsError.textContent = '';
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_context: userContextInput.value,
        custom_instructions: instructionsInput.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    await showPersonaList();
  } catch (err) {
    settingsError.textContent = err.message;
  } finally {
    settingsSaveBtn.disabled = false;
  }
});

saveBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  const persona = personaInput.value.trim();
  if (!name || !persona) {
    setupError.textContent = 'Please fill in a name and a personality description.';
    return;
  }

  saveBtn.disabled = true;
  setupError.textContent = '';
  try {
    const isEditing = editingPersonaId != null;
    const url = isEditing ? `/api/personas/${editingPersonaId}` : '/api/personas';
    const method = isEditing ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, persona, avatar: selectedAvatar }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    await openChat(data.persona.id);
  } catch (err) {
    setupError.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

resetBtn.addEventListener('click', () => {
  resetBtn.classList.add('hidden');
  resetConfirm.classList.remove('hidden');
});

resetCancelBtn.addEventListener('click', () => {
  resetConfirm.classList.add('hidden');
  resetBtn.classList.remove('hidden');
});

resetConfirmBtn.addEventListener('click', async () => {
  if (editingPersonaId == null) return;
  resetConfirmBtn.disabled = true;
  try {
    const res = await fetch(`/api/personas/${editingPersonaId}/reset`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reset persona');
    await openChat(editingPersonaId);
  } catch (err) {
    setupError.textContent = err.message;
  } finally {
    resetConfirmBtn.disabled = false;
  }
});

deleteBtn.addEventListener('click', async () => {
  if (editingPersonaId == null) return;
  if (!confirm('Delete this persona and all of its chat history? This cannot be undone.')) return;

  try {
    const res = await fetch(`/api/personas/${editingPersonaId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete persona');
    if (getActivePersonaId() === editingPersonaId) setActivePersonaId(null);
    await boot();
  } catch (err) {
    setupError.textContent = err.message;
  }
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !activeChatPersona || sending) return;

  chatInput.value = '';
  sendMessage(text, { fromInput: true });
});

commandBar.querySelectorAll('[data-command]').forEach((btn) => {
  btn.addEventListener('click', () => {
    closeSkipToPanel();
    sendMessage(btn.dataset.command);
  });
});

undoLastTurnBtn.addEventListener('click', undoLastTurn);

doBtn.addEventListener('click', () => {
  closeSkipToPanel();
  chatInput.value = 'DO ';
  chatInput.focus();
});

skipToBtn.addEventListener('click', () => {
  if (skipToPanel.classList.contains('hidden')) {
    openSkipToPanel();
  } else {
    closeSkipToPanel();
  }
});

skipToClose.addEventListener('click', closeSkipToPanel);

skipToForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const situation = skipToInput.value.trim();
  if (situation) skipTo(situation);
});

window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('service worker registration failed:', err);
    });
  });
}

boot();
