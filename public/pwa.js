/* «Ilovani yuklab olish»: panelni kompyuter yoki telefonga alohida ilova (PWA) sifatida o‘rnatish.
   Chrome/Edge/Android — brauzerning o‘z o‘rnatish oynasi; iPhone, Mac Safari va boshqalarda — qisqa yo‘riqnoma.
   O‘rnatilgan ilova ichida tugmalar yashiriladi (html.pwa). Tashqi kutubxonasiz; panelda ham, kirish sahifasida ham ishlaydi. */
(() => {
  const root = document.documentElement;
  const installed = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
  if (installed()) root.classList.add('pwa');

  // O‘rnatilgan ilova telefonda: panel kompyuterdagidek to‘liq ko‘rinishda (1280 px) ochiladi — avval butun sahifa ekranga
  // sig‘adigan kichik holatda, keyin barmoq bilan kattalashtirib-kichiklashtirib yoziladi. Oddiy brauzerda telefon ko‘rinishi qoladi.
  // Shu skript <head> da viewport’dan keyin (defer’siz) ulanadi — sahifa chizilishidan oldin ishlashi kerak.
  const vp = document.querySelector('meta[name="viewport"][data-app-width]');
  if (vp && installed() && Math.min(screen.width, screen.height) < 900) vp.setAttribute('content', `width=${vp.dataset.appWidth}, viewport-fit=cover`);
  // Kompyuterda ilova oynasi birinchi marta tor ochilsa (telefon ko‘rinishi chiqadi) — bir marta kattalashtiriladi
  else if (vp && installed() && outerWidth < 1100 && matchMedia('(pointer: fine)').matches) {
    let done = false; try { done = localStorage.getItem('pb_win') === '1'; localStorage.setItem('pb_win', '1'); } catch {}
    if (!done) try { const w = Math.min(screen.availWidth, 1440), h = Math.min(screen.availHeight, 900); resizeTo(w, h); moveTo((screen.availWidth - w) / 2, (screen.availHeight - h) / 2); } catch {}
  }
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

  let deferred = null;   // Chrome/Edge o‘rnatish taklifi — tugma bosilganda ko‘rsatiladi
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; });
  addEventListener('appinstalled', () => { deferred = null; notify('Ilova o‘rnatildi — «Photobuy» belgisi ish stolida yoki bosh ekranda.'); });

  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /Telegram|Instagram|FBAN|FBAV|; wv\)/i.test(ua);   // Telegram/Instagram ichidagi brauzer
  const firefox = /Firefox|FxiOS/i.test(ua);
  const safari = /Safari/i.test(ua) && !/Chrome|CriOS|Chromium|Edg|OPR|FxiOS|Firefox|Android/i.test(ua);
  const android = /Android/i.test(ua);

  function notify(text) {
    const box = document.getElementById('toasts'); if (!box) return;
    const el = document.createElement('div'); el.className = 'toast ok'; el.textContent = text;
    box.appendChild(el); setTimeout(() => el.remove(), 6000);
  }
  function steps() {
    if (inApp) return ['Brauzerda oching', ['Panel Telegram yoki Instagram ichida ochilgan — u yerdan ilova o‘rnatib bo‘lmaydi.',
      'Burchakdagi <b>⋮</b> yoki <b>⋯</b> menyusidan <b>«Brauzerda ochish»</b> ni tanlang.', 'Keyin <b>«Ilovani yuklab olish»</b> tugmasini yana bosing.']];
    if (ios) return ['iPhone’ga o‘rnatish', ['<b>«Ulashish»</b> belgisini bosing — kvadrat va yuqoriga strelka (Safari’da pastda, Chrome’da yuqorida).',
      'Ro‘yxatdan <b>«Bosh ekranga qo‘shish»</b> (Add to Home Screen) ni tanlang.', '<b>«Qo‘shish»</b> ni bosing — bosh ekranda Photobuy belgisi paydo bo‘ladi.']];
    if (firefox) return ['Chrome yoki Edge kerak', ['Firefox ilova o‘rnata olmaydi.', 'Panelni <b>Google Chrome</b> yoki <b>Microsoft Edge</b>’da oching.',
      '<b>«Ilovani yuklab olish»</b> tugmasini bosing.']];
    if (safari) return ['Mac’ga o‘rnatish', ['Yuqoridagi menyudan <b>«Fayl»</b> → <b>«Dock’ga qo‘shish»</b> (Add to Dock) ni tanlang.',
      '<b>«Qo‘shish»</b> ni bosing — Photobuy Dock’da alohida ilova bo‘lib turadi.']];
    if (android) return ['Telefonga o‘rnatish', ['Brauzer menyusini oching — yuqoridagi <b>⋮</b>.', '<b>«Ilovani o‘rnatish»</b> yoki <b>«Bosh ekranga qo‘shish»</b> ni tanlang.',
      '<b>«O‘rnatish»</b> ni bosing — bosh ekranda Photobuy belgisi paydo bo‘ladi.']];
    return ['Kompyuterga o‘rnatish', ['Manzil satrining o‘ng chetidagi <b>«O‘rnatish»</b> belgisini bosing (monitor va strelka) yoki menyu <b>⋮</b> → <b>«Saqlash va ulashish»</b> → <b>«Ilovani o‘rnatish»</b>.',
      'Ilova alohida oynada ochiladi: oynani kichraytirish va kattalashtirish mumkin, sahifa o‘lchami — <b>Ctrl +</b> / <b>Ctrl −</b>.',
      'Belgi chiqmasa — ilova allaqachon o‘rnatilgan: uni Start menyusi yoki ish stolidan oching.']];
  }
  function help() {
    const [title, list] = steps();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${title}"><h2>${title}</h2>
      <ol class="pwa-steps">${list.map(s => `<li>${s}</li>`).join('')}</ol>
      <p class="muted" style="margin:0;font-size:12.5px">Ilova — shu panelning o‘zi: kirish, suhbatlar va hamma bo‘limlar bir xil. Sayt yangilansa, ilova ham o‘zi yangilanadi.</p>
      <div class="row-actions" style="justify-content:flex-end"><button class="btn primary" type="button" data-close>Tushunarli</button></div></div>`;
    const onKey = e => { if (e.key === 'Escape') close(); };
    const close = () => { back.remove(); removeEventListener('keydown', onKey); };
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    addEventListener('keydown', onKey);
    document.body.appendChild(back);
    back.querySelector('[data-close]').focus();
  }
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-install]'); if (!b) return;
    e.preventDefault();
    if (installed()) return;
    if (!deferred) return help();
    const p = deferred; deferred = null;
    p.prompt();
    await p.userChoice.catch(() => null);
  });
})();
