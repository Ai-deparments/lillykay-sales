/* Kirish sahifasi. CSP: sahifa ichida skript yozilmaydi — kod shu faylda. */
const $ = id => document.getElementById(id);
/* Telefonni qanday yozsa ham bir ko‘rinishga keltiramiz: «+998 90 123 45 67», «901234567» → «998901234567».
   Harf bo‘lsa — eski matnli login, tegilmaydi. */
const normLogin = v => {
  const s = String(v || '').trim();
  if (/[A-Za-z]/.test(s)) return s.toLowerCase();
  const d = s.replace(/\D/g, '');
  return d.length === 9 ? '998' + d : d;
};
const pw = $('password'), eye = $('eye'), caps = $('caps'), err = $('err'), btn = document.querySelector('.login button[type="submit"]');

/* Ko‘zcha: parolni ko‘rsatish/yashirish */
eye.addEventListener('click', () => {
  const show = pw.type === 'password';
  pw.type = show ? 'text' : 'password';
  eye.setAttribute('aria-pressed', String(show));
  const label = show ? 'Parolni yashirish' : 'Parolni ko‘rsatish';
  eye.setAttribute('aria-label', label);
  eye.title = label;
  pw.focus();
  pw.setSelectionRange(pw.value.length, pw.value.length);
});

/* Caps Lock — parol noto‘g‘ri chiqishining eng ko‘p uchraydigan sababi */
const checkCaps = e => { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
for (const el of [pw, $('login')]) {
  el.addEventListener('keydown', checkCaps);
  el.addEventListener('keyup', checkCaps);
  el.addEventListener('blur', () => { caps.hidden = true; });
}

$('f').addEventListener('submit', async e => {
  e.preventDefault();
  err.textContent = '';
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Tekshirilmoqda…';
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: normLogin($('login').value), password: pw.value }) });
    if (r.ok) { location.href = '/'; return; }
    const j = await r.json().catch(() => ({}));
    err.textContent = j.error === 'too_many'
      ? 'Juda ko‘p urinish. 10 daqiqadan keyin qayta urinib ko‘ring.'
      : 'Login yoki parol noto‘g‘ri. Parolni unutgan bo‘lsangiz — pastdagi yozuvni bosing.';
    pw.select();
  } catch {
    err.textContent = 'Aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.';
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});
