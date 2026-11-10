/* Portal APH Cloudflare — service worker minimalista e seguro.
 * SOMENTE interface estática: nunca processar ou armazenar /api/, dados do Google,
 * vídeos, PDFs, tokens, respostas administrativas ou origens externas.
 */
const CACHE_PREFIX = 'aph-cloudflare-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v2-d1-20261110';
const CORE = [
  '/index.html', '/config.js', '/pwa.js', '/offline.html', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-maskable-192.png', '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png', '/icons/favicon-32.png'
];
const CORE_SET = new Set(CORE);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Uma falha momentânea em um ícone não impede o service worker de instalar.
    await Promise.allSettled(CORE.map(async path => {
      const response = await fetch(new Request(path, {cache: 'reload'}));
      if (response.ok && response.type === 'basic') await cache.put(path, response);
    }));
    // NÃO skipWaiting automaticamente: o administrador pode estar editando um formulário.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'APH_ACTIVATE_UPDATE') self.skipWaiting();
});

async function getNetworkOrCache(request, key, fallback) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      // Atualiza somente páginas estáticas, sem respostas do catálogo ou do admin.
      await cache.put(key, response.clone());
    }
    return response;
  } catch (_) {
    return (await cache.match(key)) || (fallback ? await cache.match(fallback) : null) ||
      new Response('Sem conexão.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // YouTube, Drive e outros: fora do PWA
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return; // SEM cache da API
  if (request.mode === 'navigate') {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(getNetworkOrCache(request, '/index.html', '/offline.html'));
    }
    return;
  }
  if (url.pathname === '/config.js' || url.pathname === '/pwa.js') {
    // network-first, evita configuração e lógica antigas após um deploy
    event.respondWith(getNetworkOrCache(request, url.pathname));
    return;
  }
  if (CORE_SET.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url.pathname);
      return hit || getNetworkOrCache(request, url.pathname);
    })());
  }
  // Demais caminhos são entregues normalmente pelo Cloudflare (sem cache PWA).
});
