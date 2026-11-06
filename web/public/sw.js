/* Sun HighTech ilovasi (PWA) uchun xizmat ishchisi.
   Hech narsa keshlanmaydi — panel doim serverdan yangi ochiladi, deploydan keyin ilova ham o‘zi yangilanadi.
   Faqat internet yo‘q bo‘lsa: oq ekran o‘rniga tushunarli sahifa va «Qayta urinish» tugmasi. */
const OFFLINE = `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Internet yo‘q · Sun HighTech</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EDF0EE;color:#131817;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px;box-sizing:border-box;text-align:center}
@media (prefers-color-scheme:dark){body{background:#0E1312;color:#E3EAE8}}
b{display:block;font-size:18px;margin-bottom:6px}p{margin:0 0 18px;opacity:.75}
a{display:inline-block;background:#0D6966;color:#fff;border-radius:10px;padding:10px 18px;text-decoration:none;font-weight:600}
</style></head><body><div><b>Internet bilan aloqa yo‘q</b><p>Ulanish tiklangach panel o‘zi ochiladi.</p><a href="/">Qayta urinish</a></div>
<script>addEventListener('online', () => location.reload())</script></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;   // API, rasm, skript — brauzerning odatdagi yo‘li
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
