/* NEO_Condomínio — service worker: cache offline + recebimento de Compartilhar (Web Share Target) */
const CACHE = 'neo-v0-6';
const ARQUIVOS = ['./', './index.html', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Compartilhar do WhatsApp (ou de qualquer app): o sistema faz POST ./share com os campos do manifest
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const fd = await e.request.formData();
      const item = { recebido_em: new Date().toISOString(), title: fd.get('title') || '', text: fd.get('text') || '', url: fd.get('url') || '', files: [] };
      for (const f of fd.getAll('media')) { if (f && f.size) item.files.push({ name: f.name, type: f.type, blob: f }); }
      await guardarCompartilhado(item);
      return Response.redirect('./?share=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  // rede primeiro para os próprios arquivos (pega versão nova), cache como reserva; nunca intercepta a API
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});

function guardarCompartilhado(item) {
  return new Promise((res, rej) => {
    const open = indexedDB.open('neo_condominio', 1);
    open.onupgradeneeded = ev => criarStores(ev.target.result);
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('compartilhados', 'readwrite');
      tx.objectStore('compartilhados').add(item); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
    };
  });
}
function criarStores(db) {
  for (const s of ['notas', 'midias', 'tarefas', 'agenda', 'financeiro', 'cadastros', 'config']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
  if (!db.objectStoreNames.contains('compartilhados')) db.createObjectStore('compartilhados', { autoIncrement: true });
}
