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

let selectedAvatar = AVATAR_OPTIONS[0];
let editingPersonaId = null; // null = create mode in setup screen
let activeChatPersona = null; // persona object currently shown in chat screen
let knownPersonaCount = 0;

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

function addBubble(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = text;
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

  if (persona) {
    setupTitle.textContent = `Edit ${persona.name}`;
    nameInput.value = persona.name;
    personaInput.value = persona.persona;
    selectedAvatar = persona.avatar;
    saveBtn.textContent = 'Save changes';
    deleteBtn.classList.remove('hidden');
  } else {
    setupTitle.textContent = 'Create your companion';
    nameInput.value = '';
    personaInput.value = '';
    selectedAvatar = AVATAR_OPTIONS[0];
    saveBtn.textContent = 'Start chatting';
    deleteBtn.classList.add('hidden');
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

  const res = await fetch(`/api/personas/${persona.id}/messages`);
  const { messages } = await res.json();
  messagesEl.innerHTML = '';
  messages.forEach((m) => addBubble(m.role, m.content));
  updateOfflineBanner();
  chatInput.focus();
}

function updateOfflineBanner() {
  const offline = !navigator.onLine;
  offlineBanner.classList.toggle('hidden', !offline);
  chatInput.disabled = offline;
  chatForm.querySelector('button').disabled = offline;
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

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !activeChatPersona) return;

  chatInput.value = '';
  addBubble('user', text);
  const pending = addBubble('assistant', '…');
  pending.classList.add('pending');
  chatInput.disabled = true;

  try {
    const res = await fetch(`/api/personas/${activeChatPersona.id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to get a reply');
    pending.textContent = data.reply;
    pending.classList.remove('pending');
    setMood(data.mood);
  } catch (err) {
    pending.textContent = `Couldn't send that: ${err.message}`;
    pending.classList.remove('pending');
    chatInput.value = text;
  } finally {
    chatInput.disabled = !navigator.onLine;
    chatInput.focus();
  }
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
