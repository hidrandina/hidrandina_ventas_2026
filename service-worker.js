// HIDRANDINA: PWA minimalista. No intercepta ni almacena peticiones a Google.
const CACHE_NAME='hidrandina-shell-v1';
self.addEventListener('install',event=>{ self.skipWaiting(); });
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
// Se conserva la conexión en línea; la aplicación no promete trabajo sin internet.
self.addEventListener('fetch',event=>{
  const requestUrl=new URL(event.request.url);
  if(requestUrl.origin===self.location.origin && event.request.method==='GET') {
    event.respondWith(fetch(event.request)); // Solo en línea, sin caché documental.
  }
});
