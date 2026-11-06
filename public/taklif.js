/* Taklif havolasi: xodim o‘zi parol qo‘yadi va o‘sha zahoti panelga kiradi.
   CSP: sahifa ichida skript yozilmaydi — kod shu faylda. */
const $ = id => document.getElementById(id);
const ROLE = { admin: 'Administrator', rahbar: 'Rahbar', filial: 'Filial rahbari', sotuvchi: 'Sotuvchi' };
const key = new URLSearchParams(location.search).get('k') || '';

const showBad = why => { $('f').hidden = true; $('bad').hidden = false; if (why) $('badWhy').textContent = why; };

(async () => {
  if (!key) return showBad('Havola to‘liq emas — uni to‘liq nusxalab, qaytadan oching.');
  let r;
  try { r = await fetch('/api/invite?k=' + encodeURIComponent(key)); } catch { return showBad('Aloqa yo‘q. Internetni tekshirib, qayta oching.'); }
  if (!r.ok) return showBad();
  const i = await r.json();
  if (i.reset) {
    // Parolni almashtirish: hisob allaqachon bor, faqat yangi parol qo‘yiladi
    $('hello').textContent = 'Yangi parol';
    document.querySelector('.login-sub').textContent = `${i.name} — yangi parol o‘ylab toping. Eski parol va boshqa qurilmalardagi kirishlar bekor bo‘ladi.`;
    document.querySelector('#f button[type="submit"]').textContent = 'Yangi parolni saqlash';
  } else $('hello').textContent = `Salom, ${i.name.split(' ')[0]}!`;
  $('iName').textContent = i.name;
  $('iLogin').textContent = i.login;
  $('iRole').textContent = ROLE[i.role] || i.role;
  if (i.branch) { $('iBranch').textContent = i.branch; $('iBranchRow').hidden = false; }
  $('f').hidden = false;
  $('password').focus();
})();

/* Ko‘zcha */
$('eye').addEventListener('click', () => {
  const pw = $('password'), show = pw.type === 'password';
  pw.type = show ? 'text' : 'password';
  $('eye').setAttribute('aria-pressed', String(show));
  const label = show ? 'Parolni yashirish' : 'Parolni ko‘rsatish';
  $('eye').setAttribute('aria-label', label); $('eye').title = label;
  pw.focus();
});

/* Parol kuchi — sodda va halol: uzunlik va xilma-xillik */
$('password').addEventListener('input', () => {
  const v = $('password').value;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(v)).length;
  const hint = $('hint');
  if (!v) { hint.textContent = 'Kamida 8 belgi'; hint.className = 'pw-hint'; return; }
  if (v.length < 8) { hint.textContent = `Yana ${8 - v.length} belgi kerak`; hint.className = 'pw-hint weak'; return; }
  hint.textContent = kinds >= 3 ? 'Yaxshi parol' : 'Ishlaydi, lekin raqam yoki katta harf qo‘shsangiz kuchliroq bo‘ladi';
  hint.className = 'pw-hint ' + (kinds >= 3 ? 'good' : 'mid');
});

/* Caps Lock */
const checkCaps = e => { if (e.getModifierState) $('caps').hidden = !e.getModifierState('CapsLock'); };
for (const id of ['password', 'password2']) {
  $(id).addEventListener('keydown', checkCaps);
  $(id).addEventListener('keyup', checkCaps);
  $(id).addEventListener('blur', () => { $('caps').hidden = true; });
}

$('f').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('err'); err.textContent = '';
  const pw = $('password').value, pw2 = $('password2').value;
  if (pw.length < 8) { err.textContent = 'Parol kamida 8 belgidan iborat bo‘lsin.'; return $('password').focus(); }
  if (pw !== pw2) { err.textContent = 'Parollar bir xil emas.'; return $('password2').focus(); }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; const prev = btn.textContent; btn.textContent = 'Saqlanmoqda…';
  try {
    const r = await fetch('/api/invite/accept', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ k: key, password: pw }) });
    if (r.ok) { location.href = '/'; return; }
    const j = await r.json().catch(() => ({}));
    err.textContent = {
      invite_bad: 'Havola eskirgan yoki allaqachon ishlatilgan. Rahbaringizdan yangisini so‘rang.',
      login_taken: 'Bu login band bo‘lib qolgan. Rahbaringizga ayting.',
      weak_password: 'Parol kamida 8 belgidan iborat bo‘lsin.',
      too_many: 'Juda ko‘p urinish. 10 daqiqadan keyin qayta urinib ko‘ring.'
    }[j.error] || 'Saqlanmadi. Qaytadan urinib ko‘ring.';
  } catch {
    err.textContent = 'Aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.';
  } finally { btn.disabled = false; btn.textContent = prev; }
});
