'use client';
import { useEffect, useRef, useState } from 'react';
import { BRAND, LOGO_SVG } from '@/lib/brand';
import type { FormEvent, KeyboardEvent } from 'react';

/* Taklif havolasi: xodim o‘zi parol qo‘yadi va o‘sha zahoti panelga kiradi (eski taklif.html + taklif.js) */
const ROLE: Record<string, string> = { admin: 'Administrator', rahbar: 'Rahbar', filial: 'Filial rahbari', sotuvchi: 'Sotuvchi' };
const LOGO = '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5 16 12M19.36 7.75 14 15.46M19.36 16.25 10 15.46M12 20.5 8 12M4.64 16.25 10 8.54M4.64 7.75 14 8.54"/>';
const ERRORS: Record<string, string> = {
  invite_bad: 'Havola eskirgan yoki allaqachon ishlatilgan. Rahbaringizdan yangisini so‘rang.',
  login_taken: 'Bu login band bo‘lib qolgan. Rahbaringizga ayting.',
  weak_password: 'Parol kamida 8 belgidan iborat bo‘lsin.',
  too_many: 'Juda ko‘p urinish. 10 daqiqadan keyin qayta urinib ko‘ring.'
};

interface Invite { name: string; login: string; role: string; branch?: string | null; reset?: boolean }

const Brand = () => (
  <div className="brand login-brand" style={{ padding: 0 }}>
    <div className="brand-mark sun" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
    <div><div className="brand-name">{BRAND.name}</div><div className="brand-sub">{BRAND.tag}</div></div>
  </div>
);

export function InviteForm() {
  const [key, setKey] = useState<string | null>(null);
  const [inv, setInv] = useState<Invite | null>(null);
  const [bad, setBad] = useState<string | null>(null);      // null — havola to‘g‘ri yoki hali tekshirilmoqda
  const [show, setShow] = useState(false);
  const [pw, setPw] = useState('');
  const [caps, setCaps] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tgLink, setTgLink] = useState<string | null>(null);   // parol saqlangach — Telegram ulash havolasi (server beradi, 7 kun)
  const pwRef = useRef<HTMLInputElement>(null);
  const pw2Ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = new URLSearchParams(location.search).get('k') || '';
    setKey(k);
    (async () => {
      if (!k) return setBad('Havola to‘liq emas — uni to‘liq nusxalab, qaytadan oching.');
      let r: Response;
      try { r = await fetch('/api/invite?k=' + encodeURIComponent(k)); } catch { return setBad('Aloqa yo‘q. Internetni tekshirib, qayta oching.'); }
      if (!r.ok) return setBad('');
      setInv(await r.json());
    })();
  }, []);
  useEffect(() => { if (inv) pwRef.current?.focus(); }, [inv]);

  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => { if (e.getModifierState) setCaps(e.getModifierState('CapsLock')); };

  /* Parol kuchi — sodda va halol: uzunlik va xilma-xillik */
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(pw)).length;
  let hint = 'Kamida 8 belgi', hintCls = 'pw-hint';
  if (pw && pw.length < 8) { hint = `Yana ${8 - pw.length} belgi kerak`; hintCls = 'pw-hint weak'; }
  else if (pw) { hint = kinds >= 3 ? 'Yaxshi parol' : 'Ishlaydi, lekin raqam yoki katta harf qo‘shsangiz kuchliroq bo‘ladi'; hintCls = 'pw-hint ' + (kinds >= 3 ? 'good' : 'mid'); }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const p1 = pwRef.current?.value ?? '', p2 = pw2Ref.current?.value ?? '';
    if (p1.length < 8) { setErr('Parol kamida 8 belgidan iborat bo‘lsin.'); return pwRef.current?.focus(); }
    if (p1 !== p2) { setErr('Parollar bir xil emas.'); return pw2Ref.current?.focus(); }
    setBusy(true);
    try {
      const r = await fetch('/api/invite/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: key, password: p1 }) });
      const j = await r.json().catch(() => ({}));
      // Telegram hali ulanmagan bo‘lsa — avval shuni ulab olsin (Nazorat eslatmalari shu yerga keladi), keyin panelga
      if (r.ok) { if (j.telegram) setTgLink(String(j.telegram)); else location.href = '/'; return; }
      setErr(ERRORS[j.error as string] || 'Saqlanmadi. Qaytadan urinib ko‘ring.');
    } catch {
      setErr('Aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.');
    } finally { setBusy(false); }
  };

  const label = show ? 'Parolni yashirish' : 'Parolni ko‘rsatish';
  const reset = Boolean(inv?.reset);
  const copy = <p className="copy">{BRAND.name} · {new Date().getFullYear()} · Ma’lumotlar faqat kompaniya ichida</p>;
  if (tgLink) {
    return (
      <div className="login-wrap">
        <div className="login auth" id="tgdone">
          <Brand />
          <div className="banner ok" role="status"><svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg><p>Parol saqlandi. Hisobingiz faol.</p></div>
          <div><h1>Telegram’ni ulang</h1>
            <p className="login-sub">Shunda 24 soat ichida bog‘lanilmagan lidlar haqida eslatmalar shaxsan sizga keladi. Bu 1 daqiqa oladi.</p></div>
          <ol className="inv-steps">
            <li><span className="num">1</span><span>Tugmani bosing — Telegram ochiladi</span></li>
            <li><span className="num">2</span><span>Botda «Start» ni bosing</span></li>
            <li><span className="num">3</span><span>Tayyor — panelga kiring</span></li>
          </ol>
          <div className="auth-actions">
            <a className="btn primary block" id="tgOpen" href={tgLink} target="_blank" rel="noopener"><svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>Telegram’ni ulash</a>
            <a className="btn block" id="tgSkip" href="/">Keyinroq — panelga kirish</a>
          </div>
          <p className="help">Havola 7 kun amal qiladi. Keyinroq ulamoqchi bo‘lsangiz — panelda «Telegram havola» tugmasi bor.</p>
        </div>
        {copy}
      </div>
    );
  }
  return (
    <div className="login-wrap">
      <form className="login auth" id="f" hidden={!inv} onSubmit={submit}>
        <Brand />
        <div>
          <h1 id="hello">{inv ? (reset ? 'Yangi parol' : `Salom, ${inv.name.split(' ')[0]}!`) : 'Xush kelibsiz'}</h1>
          <p className="login-sub">{reset && inv ? `${inv.name} — yangi parol o‘ylab toping. Eski parol va boshqa qurilmalardagi kirishlar bekor bo‘ladi.` : 'Parol o‘ylab toping — shundan keyin panelga kirasiz.'}</p>
        </div>

        <div className="inv-card">
          <div className="inv-row"><span>Ism</span><b id="iName">{inv?.name ?? '—'}</b></div>
          <div className="inv-row"><span>Login (telefon)</span><b className="mono" id="iLogin">{inv?.login ?? '—'}</b></div>
          <div className="inv-row"><span>Lavozim</span><b id="iRole">{inv ? (ROLE[inv.role] || inv.role) : '—'}</b></div>
          <div className="inv-row" id="iBranchRow" hidden={!inv?.branch}><span>Filial</span><b id="iBranch">{inv?.branch ?? '—'}</b></div>
        </div>

        <label className="field"><span>Parol o‘ylab toping</span>
          <span className="pw-row group">
            <input ref={pwRef} id="password" name="password" type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} required
              value={pw} onChange={e => setPw(e.target.value)} onKeyDown={checkCaps} onKeyUp={checkCaps} onBlur={() => setCaps(false)} />
            <button className="pw-eye" type="button" id="eye" aria-pressed={show} aria-label={label} title={label} onClick={() => { setShow(s => !s); pwRef.current?.focus(); }}>
              <svg className="ic ic-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg className="ic ic-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.9 5.8A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6.4 7.7A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6"/><path d="m3.5 3.5 17 17"/></svg>
            </button>
          </span>
          <span className={hintCls} id="hint">{hint}</span>
        </label>

        <label className="field"><span>Parolni takrorlang</span><input ref={pw2Ref} id="password2" type="password" autoComplete="new-password" minLength={8} required onKeyDown={checkCaps} onKeyUp={checkCaps} onBlur={() => setCaps(false)} /></label>

        <div className="caps" id="caps" hidden={!caps}>
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4.5 4.5 12h4v4h7v-4h4z"/><path d="M8.5 19.5h7"/></svg>
          Caps Lock yoqilgan
        </div>
        <div className="err" id="err" role="alert">{err}</div>
        <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Saqlanmoqda…' : reset ? 'Yangi parolni saqlash' : 'Parolni saqlab, kirish'}</button>
        <p className="help">Parolni hech kimga aytmang. Havola bir marta ishlaydi — kirgandan keyin u yopiladi.</p>
      </form>

      <div className="login auth" id="bad" hidden={bad === null}>
        <Brand />
        <div>
          <h1>Havola ishlamaydi</h1>
          <p className="login-sub" id="badWhy">{bad || 'Havolaning muddati o‘tgan yoki u allaqachon ishlatilgan.'}</p>
        </div>
        <p className="help">Rahbaringizdan yangi havola so‘rang. Hisobingiz allaqachon ochilgan bo‘lsa, <a href="/login">kirish sahifasiga</a> o‘ting.</p>
      </div>
      {copy}
    </div>
  );
}
