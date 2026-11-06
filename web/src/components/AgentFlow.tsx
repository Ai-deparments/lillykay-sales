'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Brand, Icon } from './ui';

/* «Jonli xarita»: markazda AI agent, atrofida Telegram, Instagram, BILLZ va AI modeli. Har bir haqiqiy voqea — yangi mijoz xabari,
   AI so‘rovi, BILLZ sinxroni, yuborilgan javob — chiziq bo‘ylab harakatlanuvchi nuqta bo‘lib ko‘rinadi: so‘rov borib, javob qaytadi.
   Ma’lumot /api/agent/pulse dan 3 soniyada bir olinadi. Demo rejimida (ulanmagan kanal/xizmat uchun) namunaviy harakat
   ko‘rsatiladi va «Demo» deb belgilanadi — u haqiqiy ma’lumot emas. */
type NodeKey = 'tg' | 'ig' | 'billz' | 'ai';
type Kind = 'req' | 'res' | 'msg';   // CSS: k-req / k-res / k-msg (chatdagi .msg bilan to‘qnashmasin)
interface Pulse {
  cursor: number; now: number; demo: boolean; ai_calls: number; billz_at: number; ai_detail: string;
  delta: { tg: { in: number; out: number }; ig: { in: number; out: number } };
  state: Record<NodeKey, string>;
}
interface Packet { id: number; node: NodeKey; dir: 'out' | 'in'; kind: Kind }

const NODES: NodeKey[] = ['tg', 'ig', 'billz', 'ai'];
const POS: Record<NodeKey, { x: number; y: number }> = { tg: { x: 150, y: 75 }, ig: { x: 150, y: 265 }, billz: { x: 850, y: 75 }, ai: { x: 850, y: 265 } };
/* out — markazdan tugunga, in — tugundan markazga (SVG yo‘llari, viewBox 1000×340) */
const PATH_OUT: Record<NodeKey, string> = {
  tg: 'M445 170 C 360 170, 350 75, 262 75', ig: 'M445 170 C 360 170, 350 265, 262 265',
  billz: 'M555 170 C 640 170, 650 75, 738 75', ai: 'M555 170 C 640 170, 650 265, 738 265',
};
const PATH_IN: Record<NodeKey, string> = {
  tg: 'M262 75 C 350 75, 360 170, 445 170', ig: 'M262 265 C 350 265, 360 170, 445 170',
  billz: 'M738 75 C 650 75, 640 170, 555 170', ai: 'M738 265 C 650 265, 640 170, 555 170',
};
const NAME: Record<NodeKey, string> = { tg: 'Telegram', ig: 'Instagram', billz: 'BILLZ', ai: 'AI modeli' };
const DUR = 1150;   // bitta nuqtaning yo‘lda bo‘lish vaqti, ms
const hms = (t: number) => new Date(t).toLocaleTimeString('uz-UZ', { hour12: false });

function stateText(n: NodeKey, st: string, detail: string): string {
  if (st === 'ok') return n === 'ai' ? (detail.split(/[·—(]/)[0].trim() || 'Tayyor') : 'Ulangan';
  if (st === 'demo') return 'Demo ma’lumot';
  if (st === 'pending') return 'Kutilmoqda';
  if (st === 'error') return 'Xato';
  return n === 'ai' ? 'Kalit kiritilmagan' : 'Ulanmagan';
}

export function AgentFlow() {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [hit, setHit] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<Set<NodeKey>>(new Set());
  const [seen, setSeen] = useState<Record<string, { n: number; at: number }>>({});
  const timers = useRef<number[]>([]);
  const seq = useRef(0);
  const prev = useRef<{ cursor: number; ai: number; billz: number } | null>(null);
  const P = useRef<Pulse | null>(null);

  const later = useCallback((fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  const flash = useCallback((key: string) => {
    setHit(h => new Set(h).add(key));
    later(() => setHit(h => { const x = new Set(h); x.delete(key); return x; }), 650);
  }, [later]);

  /* Bitta nuqta: dir out — markazdan tugunga, in — tugundan markazga. Yetib borganda maqsad «uriladi» */
  const fire = useCallback((node: NodeKey, dir: 'out' | 'in', kind: Kind) => {
    const id = ++seq.current;
    setPackets(p => [...p, { id, node, dir, kind }]);
    setLines(l => new Set(l).add(node));
    later(() => {
      setPackets(p => p.filter(x => x.id !== id));
      setLines(l => { const x = new Set(l); x.delete(node); return x; });
    }, DUR + 120);
    later(() => {
      flash(dir === 'out' ? node : 'center');
      setSeen(s => ({ ...s, [node]: { n: (s[node]?.n || 0) + 1, at: Date.now() } }));
    }, DUR - 80);
  }, [later, flash]);
  const trip = useCallback((node: NodeKey) => { fire(node, 'out', 'req'); later(() => fire(node, 'in', 'res'), DUR + 250); }, [fire, later]);

  const poll = useCallback(async () => {
    try {
      const r = await api<Pulse>(`/api/agent/pulse?since=${prev.current?.cursor || 0}`);
      const p = prev.current;
      if (p) {
        (['tg', 'ig'] as const).forEach(ch => {
          for (let i = 0; i < Math.min(r.delta[ch].in, 3); i++) later(() => fire(ch, 'in', 'msg'), i * 350);
          for (let i = 0; i < Math.min(r.delta[ch].out, 3); i++) later(() => fire(ch, 'out', 'res'), 400 + i * 350);
        });
        for (let i = 0; i < Math.min(Math.max(0, r.ai_calls - p.ai), 3); i++) later(() => trip('ai'), 300 + i * 500);
        if (r.billz_at > p.billz) later(() => trip('billz'), 600);
      }
      prev.current = { cursor: r.cursor, ai: r.ai_calls, billz: r.billz_at };
      P.current = r; setPulse(r);
    } catch { /* tarmoq uzilsa — keyingi urinishda */ }
  }, [fire, trip, later]);

  useEffect(() => {
    poll();
    const iv = window.setInterval(() => { if (!document.hidden) poll(); }, 3000);
    const ts = timers.current;
    return () => { clearInterval(iv); ts.forEach(clearTimeout); };
  }, [poll]);

  /* Demo: ulanmagan kanal/xizmatlar uchun namunaviy aylanish — mijoz xabari → AI so‘rovi → (BILLZ) → javob */
  const simOf = (n: NodeKey) => Boolean(P.current?.demo) && P.current?.state[n] !== 'ok';
  useEffect(() => {
    let alive = true, t = 0;
    const cycle = () => {
      if (!alive) return;
      const chans = (['tg', 'ig'] as const).filter(simOf);
      if (chans.length) {
        const ch = chans[Math.floor(Math.random() * chans.length)];
        fire(ch, 'in', 'msg');
        if (simOf('ai')) later(() => trip('ai'), 1500);
        if (simOf('billz') && Math.random() < 0.65) later(() => trip('billz'), 3300);
        later(() => fire(ch, 'out', 'res'), 5200);
      }
      t = window.setTimeout(cycle, 7600 + Math.random() * 1800);
    };
    t = window.setTimeout(cycle, 1200);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fire, trip, later]);

  const st = (n: NodeKey) => pulse?.state[n] || 'off';
  const live = (n: NodeKey) => st(n) === 'ok' || simOf(n);
  const anySim = NODES.some(simOf);
  const aiOk = st('ai') === 'ok' || simOf('ai');

  return (
    <div className="panel af-panel">
      <div className="panel-head">
        <h2>Jonli xarita</h2>
        <span className="muted">So‘rov borib, javob qaytayotgani shu yerda ko‘rinadi</span>
        {pulse ? (anySim ? <span className="pill ai" style={{ marginLeft: 'auto' }}>Demo: namunaviy harakat</span> : <span className="pill ok" style={{ marginLeft: 'auto' }}>Jonli</span>) : null}
      </div>
      <div className="af" role="img" aria-label="AI agent Telegram, Instagram, BILLZ va AI modeli bilan almashayotgan so‘rovlar xaritasi">
        <svg className="af-svg" viewBox="0 0 1000 340" aria-hidden="true">
          {NODES.map(n => <path key={n} d={PATH_OUT[n]} className={`af-line${live(n) ? ' on' : ''}${lines.has(n) ? ' act' : ''}`} />)}
          {packets.map(k => (
            <g key={k.id} className={`af-pk k-${k.kind}`}>
              <circle r="10" className="af-halo" /><circle r="4.5" className="af-dot" />
              <animateMotion dur={`${DUR}ms`} fill="freeze" path={k.dir === 'out' ? PATH_OUT[k.node] : PATH_IN[k.node]} calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1" />
            </g>
          ))}
        </svg>

        <div className={`af-orb${hit.has('center') ? ' hit' : ''}${aiOk ? '' : ' idle'}`}>
          <span className="af-ring r1" /><span className="af-ring r2" /><span className="af-spin" />
          <span className="af-core"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.7 4.6 2.9 6.8 7.5 7.5-4.6.7-6.8 2.9-7.5 7.5-.7-4.6-2.9-6.8-7.5-7.5 4.6-.7 6.8-2.9 7.5-7.5Z" /><path d="M19 15.5c.3 1.9 1.1 2.7 3 3-1.9.3-2.7 1.1-3 3-.3-1.9-1.1-2.7-3-3 1.9-.3 2.7-1.1 3-3Z" /></svg></span>
          <b className="af-orb-t">AI agent</b>
          <span className="af-orb-s">{aiOk ? 'ishlayapti' : 'AI kaliti kutilmoqda'}</span>
        </div>

        {NODES.map(n => {
          const s = st(n), d = seen[n];
          return (
            <div key={n} className={`af-node n-${n}${hit.has(n) ? ' hit' : ''}${live(n) ? '' : ' idle'}`} style={{ left: `${POS[n].x / 10}%`, top: `${POS[n].y / 3.4}%` }}>
              <div className="af-n-head">
                <span className="af-n-ic">{n === 'tg' || n === 'ig' ? <Brand ch={n} /> : <Icon name={n === 'ai' ? 'spark' : 'card'} />}</span>
                <b>{NAME[n]}</b><i className={`af-st ${s === 'ok' ? 'ok' : s === 'error' ? 'bad' : simOf(n) ? 'ai' : 'off'}`} />
              </div>
              <div className="af-n-sub">{simOf(n) && s !== 'ok' ? 'Demo' : stateText(n, s, pulse?.ai_detail || '')}</div>
              <div className="af-n-meta">{d ? <><b className="mono">{d.n}</b> ta · {hms(d.at)}</> : 'faoliyat kutilmoqda'}</div>
            </div>
          );
        })}
      </div>
      <div className="af-legend" aria-hidden="true">
        <span><i className="k k-msg" />Mijoz xabari</span><span><i className="k k-req" />So‘rov</span><span><i className="k k-res" />Javob</span>
      </div>
    </div>
  );
}
