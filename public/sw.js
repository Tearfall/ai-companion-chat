const CACHE_VERSION = 'v10';
const SHELL_CACHE = `companion-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `companion-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== SHELL_CACHE && name !== RUNTIME_CACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isShellRequest(url) {
  return (
    PRECACHE_URLS.includes(url.pathname) ||
    url.pathname === '/' ||
    url.pathname.startsWith('/icons/')
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    fetch(request)
      .then((response) => caches.open(SHELL_CACHE).then((cache) => cache.put(request, response)))
      .catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  const cache = await caches.open(SHELL_CACHE);
  cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') return; // never intercept writes (chat, create/edit/delete)

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isShellRequest(url)) {
    event.respondWith(cacheFirst(request));
  }
});
