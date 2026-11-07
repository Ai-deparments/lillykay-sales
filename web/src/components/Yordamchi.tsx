'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { ApiError, api, errorText, isUnauthorized } from '@/lib/api';
import { dayLabel, esc, fmtD, fmtT } from '@/lib/format';
import type { YordamchiHistory, YordamchiMsg, YordamchiReply } from '@/lib/types';
import { useApp } from './AppContext';
import { PageHead } from './Shell';
import { Icon } from './ui';

/* AI yordamchi — rahbar uchun savol-javob chati. API: GET/POST/DELETE /api/yordamchi.
   AI faqat ish haqida javob beradi (boshqa mavzuga — server tomonidan belgilangan jumla); UI filtr qilmaydi. */

const MAX_LEN = 1000;
const COUNTER_FROM = 900;
const FORBIDDEN = 'Faqat rahbar va administrator uchun';
const SUGGESTIONS = [
  'Bugun nechta lid keldi?',
  'Bu hafta eng yaxshi menejer kim?',
  'Qaysi bosqichda ko‘p yo‘qotamiz?',
  'Bugun qanday sotuvlar bo‘ldi?',
  'Instagram’dan nechta lid, nechtasi sotildi?',
  'Qotib qolgan lidlar ro‘yxati'
];

/** API xatosi → foydalanuvchiga matn. 403 — rol cheklovi; aloqa yo‘q — alohida jumla; qolgani — server bergan `why`/`error` */
function errorOf(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.data.error === 'forbidden' || e.message === 'HTTP 403') return FORBIDDEN;
    if (e.data.error === 'not_found') return 'Yordamchi serverda hali yoqilmagan — sahifani yangilang yoki administratorga ayting.';
    if (/^HTTP 50\d$/.test(e.message)) return 'Server javob bermadi — birozdan keyin qayta urinib ko‘ring.';
    return errorText(e);
  }
  if (e instanceof TypeError) return 'Server bilan aloqa yo‘q — internetni tekshiring.';
  return errorText(e);
}

/** `api()` faqat GET/POST biladi; tarixni tozalash — DELETE (CSRF uchun JSON content-type shart, 401 → /login) */
async function apiDelete(path: string): Promise<void> {
  const r = await fetch(path, { method: 'DELETE', headers: { 'content-type': 'application/json' } });
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error || `HTTP ${r.status}`, j);
}

/* Markdown-lite: matn avval esc() qilinadi, keyin faqat uchta qoida — qator uzilishi, «- » ro‘yxat, **qalin**. Natija — xavfsiz HTML. */
const bold = (s: string) => s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
export function mdLite(text: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let prevText = false;
  const flush = () => { if (list.length) { out.push(`<ul>${list.map(l => `<li>${l}</li>`).join('')}</ul>`); list = []; } };
  for (const line of esc(text).split('\n')) {
    const m = /^\s*[-•]\s+(.*)$/.exec(line);
    if (m) { list.push(bold(m[1])); prevText = false; continue; }
    flush();
    if (prevText) out.push('<br>');
    out.push(bold(line));
    prevText = true;
  }
  flush();
  return out.join('');
}

function autoGrow(t: HTMLTextAreaElement) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 150) + 'px'; }

function Bubble({ m }: { m: YordamchiMsg }) {
  if (m.role === 'user') {
    return (
      <div className="ya-msg user">
        <div className="ya-txt">{m.text}</div>
        <div className="ya-meta"><span>{fmtT(m.at)}</span></div>
      </div>
    );
  }
  const tools = m.tools?.length ? m.tools.join(', ') : '';
  return (
    <div className="ya-msg ai">
      <div className="ya-txt" dangerouslySetInnerHTML={{ __html: mdLite(m.text) }} />
      <div className="ya-meta">
        <span className="tools" title={tools ? `Ma’lumot manbalari: ${tools}` : undefined}>AI{tools ? ` · tools: ${tools}` : ''}</span>
        <span>{fmtT(m.at)}</span>
      </div>
    </div>
  );
}

export function Yordamchi({ active }: { active: boolean }) {
  const { clockNow, toast } = useApp();
  const [msgs, setMsgs] = useState<YordamchiMsg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Tarix — bo‘lim birinchi marta ochilganda; xato bo‘lsa keyingi ochilishda qayta urinadi
  useEffect(() => {
    if (!active || loaded) return;
    let dead = false;
    api<YordamchiHistory>('/api/yordamchi')
      .then(h => { if (!dead) { setMsgs(Array.isArray(h.messages) ? h.messages : []); setLoaded(true); setErr(null); } })
      .catch(e => { if (!dead && !isUnauthorized(e)) setErr(errorOf(e)); });
    return () => { dead = true; };
  }, [active, loaded]);

  // Yangi xabar yoki «Hisoblayapman…» — ro‘yxat pastga
  useLayoutEffect(() => { const b = boxRef.current; if (b) b.scrollTop = b.scrollHeight; }, [msgs, pending]);

  // Ikki bosqichli tozalash: tasdiq 5 soniyada o‘z-o‘zidan bekor bo‘ladi
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 5000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const send = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q || pending) return;
    if (q.length > MAX_LEN) { setErr(`Savol juda uzun — ${MAX_LEN} belgigacha bo‘lsin.`); return; }
    const mine: YordamchiMsg = { role: 'user', text: q, at: clockNow() };
    setErr(null); setPending(true); setText('');
    const ta = taRef.current; if (ta) ta.style.height = 'auto';
    setMsgs(m => [...m, mine]);
    try {
      const r = await api<YordamchiReply>('/api/yordamchi', { text: q });
      setMsgs(m => [...m, { role: 'ai', text: r.reply, at: r.at || clockNow(), tools: Array.isArray(r.tools) ? r.tools : [] }]);
    } catch (e) {
      if (isUnauthorized(e)) return;
      // Javob kelmadi — savol tarixga yozilmagan: pufakchani olib, matnni maydonga qaytaramiz
      setMsgs(m => m.filter(x => x !== mine));
      setText(q);
      setErr(errorOf(e));
    } finally {
      setPending(false);
      setTimeout(() => taRef.current?.focus(), 0);
    }
  }, [pending, clockNow]);

  const clear = async () => {
    setConfirmClear(false);
    try { await apiDelete('/api/yordamchi'); setMsgs([]); setErr(null); toast('Tarix tozalandi'); }
    catch (e) { if (!isUnauthorized(e)) setErr(errorOf(e)); }
  };

  const onKey = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void send(text); }
  };
  const onChange = (ev: ChangeEvent<HTMLTextAreaElement>) => { setText(ev.target.value); autoGrow(ev.target); };

  const over = text.length > MAX_LEN;
  const canSend = !pending && text.trim().length > 0 && !over;

  const parts: React.ReactNode[] = [];
  let lastDay = '';
  msgs.forEach((m, i) => {
    const day = fmtD(m.at);
    if (day !== lastDay) { parts.push(<div className="ya-day" key={'d' + i}>{dayLabel(m.at)}</div>); lastDay = day; }
    parts.push(<Bubble key={i} m={m} />);
  });

  return (
    <>
      <PageHead route="yordamchi">
        {confirmClear
          ? <>
            <span className="ya-confirm-note">Butun yozishma o‘chadi — qaytarib bo‘lmaydi</span>
            <button className="btn sm danger" type="button" data-act="clear-yes" onClick={() => { void clear(); }}><Icon name="trash" />Ha, tozalash</button>
            <button className="btn sm ghost" type="button" data-act="clear-no" onClick={() => setConfirmClear(false)}>Bekor</button>
          </>
          : <button className="btn sm" type="button" data-act="clear" disabled={pending || !msgs.length} title="Yordamchi bilan yozishmani o‘chirish" onClick={() => setConfirmClear(true)}><Icon name="broom" />Tarixni tozalash</button>}
      </PageHead>
      <div className="ya-panel">
        <div className="ya-list" ref={boxRef} aria-live="polite">
          {!msgs.length && !pending
            ? <div className="ya-empty"><b>Savolingizni yozing</b><span>Yordamchi lidlar, sotuvlar va menejerlar bo‘yicha raqamlarga qarab javob beradi. Pastdagi tayyor savollardan boshlash mumkin.</span></div>
            : parts}
          {pending ? <div className="ya-msg ai pending" aria-busy="true"><div className="ya-txt">Hisoblayapman…</div></div> : null}
        </div>
        <div className="ya-foot">
          {err ? <div className="banner bad" role="alert"><Icon name="x" /><div>{err}</div></div> : null}
          <div className="ya-chips" role="group" aria-label="Tayyor savollar">
            {SUGGESTIONS.map(s => <button key={s} className="chip" type="button" disabled={pending} onClick={() => { void send(s); }}>{s}</button>)}
          </div>
          <div className="ya-compose">
            <textarea ref={taRef} rows={1} value={text} placeholder="Savol yozing…" aria-label="Savol matni"
              disabled={pending} maxLength={MAX_LEN + 200} onChange={onChange} onKeyDown={onKey} />
            <button className="btn primary" type="button" data-act="send" disabled={!canSend} onClick={() => { void send(text); }}><Icon name="send" /><span>Yuborish</span></button>
          </div>
          <div className="ya-hint">
            <span>{pending ? 'Javob 5–15 soniyada keladi' : <><span className="ya-kbd">Enter — yuborish · Shift+Enter — yangi qator · </span>Faqat ish bo‘yicha savollar: lidlar, sotuvlar, menejerlar</>}</span>
            {text.length >= COUNTER_FROM ? <span className={`ya-count${over ? ' over' : ''}`}>{text.length}/{MAX_LEN}</span> : null}
          </div>
        </div>
      </div>
    </>
  );
}
