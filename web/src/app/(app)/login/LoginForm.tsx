'use client';
import { useRef, useState } from 'react';
import { BRAND, LOGO_SVG } from '@/lib/brand';
import type { FormEvent, KeyboardEvent } from 'react';

/* Telefonni qanday yozsa ham bir ko‘rinishga keltiramiz: «+998 90 123 45 67», «901234567» → «998901234567».
   Harf bo‘lsa — eski matnli login, tegilmaydi. */
const normLogin = (v: string): string => {
  const s = String(v || '').trim();
  if (/[A-Za-z]/.test(s)) return s.toLowerCase();
  const d = s.replace(/\D/g, '');
  return d.length === 9 ? '998' + d : d;
};

const LOGO = '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5 16 12M19.36 7.75 14 15.46M19.36 16.25 10 15.46M12 20.5 8 12M4.64 16.25 10 8.54M4.64 7.75 14 8.54"/>';

export function LoginForm() {
  const pwRef = useRef<HTMLInputElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);   // muvaffaqiyat: karta silliq yo‘qoladi, keyin panelga o‘tadi
  const [shake, setShake] = useState(false);       // xato: karta titraydi

  /* Ko‘zcha: parolni ko‘rsatish/yashirish */
  const toggle = () => {
    const next = !show;
    setShow(next);
    const pw = pwRef.current;
    if (pw) { pw.type = next ? 'text' : 'password'; pw.focus(); pw.setSelectionRange(pw.value.length, pw.value.length); }
  };
  const label = show ? 'Parolni yashirish' : 'Parolni ko‘rsatish';

  /* Caps Lock — parol noto‘g‘ri chiqishining eng ko‘p uchraydigan sababi */
  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => { if (e.getModifierState) setCaps(e.getModifierState('CapsLock')); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: normLogin(loginRef.current?.value ?? ''), password: pwRef.current?.value ?? '' }) });
      if (r.ok) { setLeaving(true); setTimeout(() => { location.href = '/'; }, 480); return; }
      const j = await r.json().catch(() => ({}));
      setErr(j.error === 'too_many'
        ? 'Juda ko‘p urinish. 10 daqiqadan keyin qayta urinib ko‘ring.'
        : 'Login yoki parol noto‘g‘ri. Parolni unutgan bo‘lsangiz — pastdagi yozuvni bosing.');
      pwRef.current?.select();
      setShake(true);
    } catch {
      setErr('Aloqa yo‘q. Internetni tekshirib, qayta urinib ko‘ring.');
      setShake(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className={`login auth${shake ? ' shake' : ''}${leaving ? ' leaving' : ''}`} id="f" onSubmit={submit} onAnimationEnd={e => { if (e.animationName === 'lg-shake') setShake(false); }}>
        <div className="brand login-brand" style={{ padding: 0 }}>
          <div className="brand-mark sun" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
          <div><div className="brand-name">{BRAND.name}</div><div className="brand-sub">{BRAND.tag}</div></div>
        </div>
        <div>
          <h1>Tizimga kirish</h1>
          <p className="login-sub">Login — telefon raqamingiz. Parolni rahbar bergan havola orqali o‘zingiz qo‘ygansiz.</p>
        </div>
        <label className="field"><span>Telefon raqamingiz</span>
          <span className="group"><span className="prefix mono">+998</span><input ref={loginRef} id="login" name="login" type="tel" inputMode="tel" autoComplete="username tel" placeholder="90 123 45 67" autoCapitalize="none" spellCheck={false} required autoFocus onKeyDown={checkCaps} onKeyUp={checkCaps} onBlur={() => setCaps(false)} /></span>
        </label>
        <label className="field"><span>Parol</span>
          <span className="pw-row group">
            <input ref={pwRef} id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required onKeyDown={checkCaps} onKeyUp={checkCaps} onBlur={() => setCaps(false)} />
            <button className="pw-eye" type="button" id="eye" aria-pressed={show} aria-label={label} title={label} onClick={toggle}>
              <svg className="ic ic-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg className="ic ic-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.9 5.8A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6.4 7.7A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.2 3.3-.6"/><path d="m3.5 3.5 17 17"/></svg>
            </button>
          </span>
        </label>
        <div className="caps" id="caps" hidden={!caps}>
          <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4.5 4.5 12h4v4h7v-4h4z"/><path d="M8.5 19.5h7"/></svg>
          Caps Lock yoqilgan — parol katta harflarda yozilyapti
        </div>
        <div className="err" id="err" role="alert">{err}</div>
        <button className="btn primary block" type="submit" disabled={busy}>{busy || leaving ? <><span className="spin" aria-hidden="true" />Tekshirilmoqda…</> : 'Kirish'}</button>
        <details className="forgot">
          <summary>Parolni unutdingizmi?<span className="muted"> Rahbaringizdan yangi havola so‘rang.</span></summary>
          <div className="forgot-body">
            <p>Parolni o‘zi tiklaydigan havola yo‘q — yangi parolni <b>rahbaringiz</b> beradi. Shunday qiling:</p>
            <ol>
              <li>Rahbaringizga yozing: «panelga kira olmayapman, parol kerak».</li>
              <li>U paneldan <b>Xodimlar va filiallar</b> bo‘limini ochadi va sizning qatoringizdagi <b>«Parolni o‘zgartirish»</b> tugmasini bosadi.</li>
              <li>Sizga havola keladi. Havolani ochib, <b>yangi parolni o‘zingiz</b> qo‘yasiz — uni hech kim, hatto rahbaringiz ham ko‘rmaydi.</li>
            </ol>
            <p className="muted">Login — ishga qabul qilinganda bergan telefon raqamingiz. Uni <span className="mono">90 123 45 67</span>, <span className="mono">+998 90 123 45 67</span> yoki <span className="mono">901234567</span> ko‘rinishida yozsangiz ham bo‘ladi. Qaysi raqam ekanini bilmasangiz, rahbaringiz aytadi.</p>
          </div>
        </details>
      </form>
      <p className="copy">{BRAND.name} · {new Date().getFullYear()} · Ma’lumotlar faqat kompaniya ichida</p>
    </div>
  );
}
