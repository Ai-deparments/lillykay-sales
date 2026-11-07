'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, ERR } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { fmtDT } from '@/lib/format';
import { dowFrom, shiftText } from '@/lib/shift';
import type { Branch } from '@/lib/types';
import { DowBoxes } from './DowBoxes';
import { useApp } from './AppContext';
import { Select } from './Select';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROLE: Record<string, string> = { admin: 'Administrator', rahbar: 'Sotuv rahbari', filial: 'Filial rahbari', sotuvchi: 'Sotuvchi' };

interface StaffUser {
  id: number; name: string; login: string; role: string; active: number | boolean; has_pass: boolean; tg_linked: boolean; tg_username?: string | null; tg_user_id?: string | number | null;
  branch_id: number | null; backup_user_id?: number | null; phone?: string; shift_dow?: string; shift_from?: string; shift_to?: string;
  odoo_user_id?: number | null; odoo_name?: string | null;
}
/* Odoo foydalanuvchilari (sinxrondan) va ism bo‘yicha taxminlar: panel xodimi id → Odoo foydalanuvchi id */
interface OdooUser { id: number; name: string; leads: number; phone: string | null; login: string | null; staff_id: number | null; invite_id: number | null }
interface OdooBind { users: OdooUser[]; suggestions: Record<string, number> }
interface Invite { id: number; name: string; login: string; role: string; branch_name?: string; kind?: string; expires_at: number; token: string; odoo_user_id?: number | null; odoo_name?: string | null }
interface BillzStaff { name: string; roles: string[]; branch?: string; checks_90d: number; login?: string; branch_id?: number | null }
interface Prefill { name?: string; login?: string; branch_id?: number | null; role?: string; phone?: string; odoo_user_id?: number }
interface BulkItem { odoo_user_id: number; name: string | null; login?: string; link: string | null; error: string | null }

/* B: shu ekranga xos chiziqli ikonlar (ui.tsx dagi IC da yo‘q) */
const UIC: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
};
const Icon = ({ name }: { name: string }) => <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: UIC[name] || '' }} />;

/* Xodimga yuboriladigan tayyor xabar: havola + nima qilish kerakligi (nusxalab Telegram’da yuboriladi) */
const inviteMsg = (name: string, link: string) =>
  `Assalomu alaykum, ${name}!\n${BRAND.name} sotuv panelida sizga hisob ochildi. Havolani oching, parol qo‘ying va «Telegram’ni ulash» tugmasini bosing — 24 soat ichida bog‘lanilmagan lidlar haqida eslatmalar shu yerga keladi.\n${link}`;

/* Havola ko‘rsatiladigan oyna tarkibi (nusxalash tugmasi bilan) */
function LinkBox({ title, text, link }: { title?: string; text: React.ReactNode; link: string }) {
  const { toast } = useApp();
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Havola nusxalandi'); } catch { toast('Havolani qo‘lda nusxalang'); } };
  return (
    <div className="usr-modal">
      <h2>{title || 'Havola tayyor'}</h2>
      <p className="lead" style={{ fontSize: 13 }}>{text}</p>
      <div className="pw-box" style={{ wordBreak: 'break-all', fontSize: 13 }}>{link}</div>
      <div className="row-actions"><button className="btn primary" type="button" id="invCopy2" onClick={copy}>Havolani nusxalash</button></div>
    </div>
  );
}

/* Tayyor xabar oynasi: matn + «Xabarni nusxalash» (havola ichida) */
function MessageBox({ title, intro, messages }: { title: string; intro: React.ReactNode; messages: { name: string; login?: string; text: string }[] }) {
  const { toast } = useApp();
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(`${what} nusxalandi`); } catch { toast('Qo‘lda nusxalang'); } };
  return (
    <div className="usr-modal">
      <h2>{title}</h2>
      <div className="banner ok"><Icon name="check" /><p>{intro}</p></div>
      <div className="inv-list">
        {messages.map(m => (
          <div key={m.name} className="inv">
            <div className="section-title">{m.name}{m.login ? <span className="mono">{m.login}</span> : null}</div>
            <div className="pw-box inv-msg">{m.text}</div>
            <div className="row-actions inv-foot"><button className="btn sm primary" type="button" data-msgcopy onClick={() => copy(m.text, m.name)}><Icon name="copy" />Xabarni nusxalash</button></div>
          </div>
        ))}
      </div>
      {messages.length > 1 ? <div className="row-actions"><button className="btn" type="button" data-msgcopyall onClick={() => copy(messages.map(m => m.text).join('\n\n'), 'Hammasi')}><Icon name="copy" />Hammasini bitta matn qilib nusxalash</button></div> : null}
    </div>
  );
}

function BranchForm({ x }: { x: Partial<Branch> }) {
  return (
    <div className="usr-modal">
      <h2>{x.id ? 'Filial' : 'Yangi filial'}</h2>
      <div className="form-grid"><label className="field"><span>Nomi</span><input name="name" id="b_name" defaultValue={x.name || ''} required /></label>
        <label className="field wide"><span>Ish kunlari</span><DowBoxes val={x.work_dow} pre="wd" /></label>
        <label className="field"><span>Ochilish</span><input type="time" name="open_from" id="b_of" defaultValue={x.open_from || ''} /></label>
        <label className="field"><span>Yopilish</span><input type="time" name="open_to" id="b_ot" defaultValue={x.open_to || ''} /></label>
        <label className="field"><span>Turi</span><Select name="kind" id="b_kind" defaultValue={x.kind === 'ombor' ? 'ombor' : 'dokon'}><option value="dokon">do‘kon (mijoz shu yerda oladi)</option><option value="ombor">ombor</option></Select></label>
        <label className="field wide"><span>Izoh</span><input name="note" id="b_note" defaultValue={x.note || ''} /></label></div>
    </div>
  );
}

export function Users({ active }: { active: boolean }) {
  const { boot: b, reloadBoot, toast, fail, openModal } = useApp();
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const [invites, setInvites] = useState<{ items: Invite[]; base: string }>({ items: [], base: '' });
  const [billz, setBillz] = useState<BillzStaff[]>([]);
  const [odoo, setOdoo] = useState<OdooBind>({ users: [], suggestions: {} });
  const [onlyLeads, setOnlyLeads] = useState(true);   // Odoo menejerlari ro‘yxati: faqat lidi borlar (admin, ombor va h.k. yashiriladi)

  const load = useCallback(async () => {
    try {
      await reloadBoot();
      const r = await api<{ items: StaffUser[]; bot: string | null; odoo?: OdooBind }>('/api/users');
      setUsers(r.items); setBot(r.bot); setOdoo(r.odoo || { users: [], suggestions: {} });
      // Kutayotgan takliflar: havola berilgan, lekin xodim hali parol qo‘ymagan
      const inv = await api<{ items: Invite[]; base: string }>('/api/invites').catch(() => ({ items: [] as Invite[], base: '' }));
      setInvites(inv);
      // BILLZ’dagi xodimlar — panelda hali yo‘qlari
      const bz = await api<{ items: BillzStaff[] }>('/api/users/billz').catch(() => ({ items: [] as BillzStaff[] }));
      setBillz(bz.items);
    } catch (e) { fail(e); }
  }, [reloadBoot, fail]);
  useEffect(() => { if (active) load(); }, [active, load]);

  if (!users) return null;
  const canAdmin = b.me.role === 'admin';

  const delUser = async (u: StaffUser) => {
    if (!confirm(`${u.name || 'Xodim'} ro‘yxatdan o‘chirilsinmi?\n\nPanelga kira olmaydi, Telegram ulanishi uziladi va yangi topshiriq olmaydi.\nEski yozishmalari, topshiriqlari va hisobotlari joyida qoladi.`)) return;
    if (!await api(`/api/users/${u.id}/delete`, {}).catch(fail)) return;
    toast('Xodim o‘chirildi — tarix saqlandi');
    await load();
  };
  const invite = (pf: Prefill = {}) => openModal({
    content: <div className="usr-modal">
      <h2>Havola bilan xodim qo‘shish</h2>
      <p className="lead" style={{ fontSize: 13 }}>Xodimga havola yuboriladi. U havolani ochib, <b>o‘zi parol qo‘yadi</b>, so‘ng Telegram’ni ulaydi va o‘ziga berilgan lavozimda darhol kiradi — parol sizdan ham, yozishmadan ham o‘tmaydi. Panelga <b>telefon raqami bilan</b> kiradi.</p>
      {pf.odoo_user_id ? <><input type="hidden" name="odoo_user_id" value={pf.odoo_user_id} /><div className="banner"><Icon name="info" /><p>Hisob ochilganda Odoo menejeri <b>{pf.name}</b> ga bog‘lanadi — Nazorat eslatmalari unga keladi.</p></div></> : null}
      <div className="form-grid">
        <label className="field"><span>Ism familiya</span><input name="name" required maxLength={80} defaultValue={pf.name || ''} /></label>
        <label className="field"><span>Lavozim</span><Select name="role" defaultValue={pf.role || 'sotuvchi'}>
          <option value="sotuvchi">Sotuvchi</option><option value="filial">Filial rahbari</option>
          {canAdmin ? <><option value="rahbar">Rahbar</option><option value="admin">Administrator</option></> : null}</Select></label>
        <label className="field"><span>Filial</span><Select name="branch_id" defaultValue={pf.branch_id ?? ''}><option value="">—</option>
          {b.branches.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
        <label className="field"><span>Telefon raqami — shu login bo‘ladi</span><input name="phone" type="tel" inputMode="tel" required placeholder="+998 90 123 45 67" title="Xodim shu raqam bilan panelga kiradi" defaultValue={pf.phone || ''} /></label>
        <label className="field"><span>Havola amal qiladi</span><Select name="days" defaultValue="7"><option value="3">3 kun</option><option value="7">7 kun</option><option value="30">30 kun</option></Select></label>
      </div>
    </div>,
    onSubmit: async data => {
      const r = await api<{ link: string }>('/api/invites', data);
      await load();
      openModal({ content: <MessageBox title="Havola tayyor" intro={<><b>{data.name}</b> ga shu xabarni Telegram’da yuboring. Havola bir marta ishlaydi: u parol qo‘yadi, Telegram’ni ulaydi va panelga kiradi.</>} messages={[{ name: String(data.name), login: String(data.phone || ''), text: inviteMsg(String(data.name), r.link) }]} /> });
    }
  });
  /* Odoo menejerlarini bir yo‘la taklif qilish (telefoni borlar): natija — har biriga tayyor xabar yoki xato */
  const bulkInvite = async (ids: number[]) => {
    if (!ids.length) return;
    if (!confirm(`${ids.length} ta Odoo menejeriga taklif havolasi yaratilsinmi?\n\nRol — sotuvchi, login — Odoo’dagi telefon raqami. Havola 7 kun amal qiladi.`)) return;
    const r = await api<{ items: BulkItem[]; created: number }>('/api/invites/odoo-bulk', { ids, days: 7 }).catch(fail); if (!r) return;
    await load();
    const ok = r.items.filter(x => x.link), bad = r.items.filter(x => !x.link);
    openModal({ content: <>
      <MessageBox title={`${ok.length} ta taklif tayyor`} intro={<>Har bir menejerga o‘z xabarini yuboring (yoki hammasini bitta matn qilib guruhga). Havola 7 kun amal qiladi, bir marta ishlaydi.</>}
        messages={ok.map(x => ({ name: x.name || String(x.odoo_user_id), login: x.login, text: inviteMsg(x.name || '', x.link as string) }))} />
      {bad.length ? <div className="banner warn usr-bad"><Icon name="info" /><p>Yaratilmadi: {bad.map(x => `${x.name || x.odoo_user_id} — ${ERR[x.error || ''] || x.error}`).join('; ')}</p></div> : null}
    </> });
  };
  const copyInvite = async (link: string) => {
    try { await navigator.clipboard.writeText(link); toast('Havola nusxalandi'); }
    catch { openModal({ content: <div className="usr-modal"><h2>Havola</h2><div className="pw-box" style={{ wordBreak: 'break-all', fontSize: 13 }}>{link}</div></div> }); }
  };
  const revoke = async (id: number) => {
    if (!confirm('Havola bekor qilinsinmi? Shundan keyin u ishlamaydi.')) return;
    if (!await api(`/api/invites/${id}/revoke`, {}).catch(fail)) return;
    toast('Havola bekor qilindi'); load();
  };
  const resetLink = async (u: StaffUser) => {
    if (!confirm(`${u.name || 'Xodim'} uchun parol havolasi yaratilsinmi?\n\nHavolani ochib, yangi parolni u o‘zi qo‘yadi. Eski paroli va boshqa qurilmalardagi kirishlari bekor bo‘ladi.`)) return;
    const r = await api<{ name: string; link: string }>(`/api/users/${u.id}/reset-link`, {}).catch(fail); if (!r) return;
    await load();
    openModal({ content: <LinkBox text={<><b>{r.name}</b> ga shu havolani yuboring — u yangi parolni o‘zi qo‘yadi. Havola 3 kun amal qiladi va bir marta ishlaydi.</>} link={r.link} /> });
  };
  const tgLink = async (u: StaffUser) => {
    const r = await api<{ link?: string }>(`/api/users/${u.id}/tglink`, {}).catch(fail); if (!r) return;
    openModal({ content: <div className="usr-modal"><h2>Telegram bildirishnomalari</h2>{r.link ? <><p className="lead" style={{ fontSize: 13.5 }}>Xodim shu havolani Telegram’da ochib «Start» bosadi (1 soat amal qiladi):</p><div className="pw-box" style={{ fontSize: 13 }}>{r.link}</div></>
      : <div className="banner warn"><Icon name="info" /><p>Bot hali ulanmagan (token kiritilmagan). Token kiritilgach havola shu yerda chiqadi.</p></div>}</div> });
  };
  /* Odoo bog‘lami: tanlov darhol saqlanadi; bo‘sh — bog‘lam olib tashlanadi */
  const bindOdoo = async (u: StaffUser, odooUserId: number | null) => {
    const r = await api<{ ok: boolean; odoo_name: string | null }>(`/api/users/${u.id}/odoo`, { odoo_user_id: odooUserId }).catch(fail); if (!r) return;
    toast(r.odoo_name ? `${u.name} ↔ ${r.odoo_name}` : `${u.name}: Odoo bog‘lami olib tashlandi`);
    await load();
  };
  const autoMatch = async () => {
    const r = await api<{ bound: number; names: string[] }>('/api/users/odoo-automatch', {}).catch(fail); if (!r) return;
    toast(r.bound ? `${r.bound} ta xodim bog‘landi: ${r.names.join(', ')}` : 'Ism bo‘yicha mos keladigan xodim yo‘q');
    await load();
  };
  const branchModal = (x: Partial<Branch>) => openModal({
    content: <BranchForm x={x} />,
    onSubmit: async d => { await api('/api/branches', { ...d, id: x.id, work_dow: dowFrom(d, 'wd') }); toast('Saqlandi'); load(); }
  });
  const editUser = (u: StaffUser) => openModal({
    content: <div className="usr-modal">
      <h2>Xodim</h2><div className="form-grid">
        <label className="field"><span>Ism</span><input name="name" id="u_name" defaultValue={u.name || ''} required /></label>
        <label className="field"><span>Login (lotin)</span><input name="login" id="u_login" defaultValue={u.login || ''} readOnly required /></label>
        <label className="field"><span>Rol</span><Select name="role" id="u_role" defaultValue={u.role}>{Object.entries(ROLE).filter(([k]) => k !== 'admin' || b.me.role === 'admin').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
        <label className="field"><span>Filial</span><Select name="branch_id" id="u_branch" defaultValue={u.branch_id ?? ''}><option value="">—</option>{b.branches.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
        <label className="field"><span>Telefon</span><input name="phone" id="u_phone" defaultValue={u.phone || ''} /></label>
        <label className="field"><span>Telegram username</span><input name="tg_username" id="u_tgname" defaultValue={u.tg_username ? '@' + u.tg_username : ''} placeholder="@hilola_photobuy" autoCapitalize="off" spellCheck={false} /></label>
        <label className="field"><span>Telegram ID (ixtiyoriy)</span><input name="tg_user_id" id="u_tgid" defaultValue={u.tg_user_id ?? ''} inputMode="numeric" placeholder="123456789" /></label>
        <p className="muted help wide" style={{ margin: 0 }}>Tizim xodimni shu username/ID bo‘yicha taniydi: u Photobuy akkauntiga yozsa — mijoz emas, sotuvchi deb biladi (AI unga mijozdek javob bermaydi). Har kuni ish boshida Photobuy akkauntiga «Salom» deb yozsa, topshiriqlar rahbar nomidan shu akkauntdan keladi; zaxira yo‘l — <b>@{bot || 'bot'}</b> da bir marta «Start».</p>
        <label className="field wide"><span>Ish kunlari (smena)</span><DowBoxes val={u.shift_dow} pre="dow" /></label>
        <label className="field"><span>Smena boshi</span><input type="time" name="shift_from" id="u_sf" defaultValue={u.shift_from || ''} /></label>
        <label className="field"><span>Smena oxiri</span><input type="time" name="shift_to" id="u_st" defaultValue={u.shift_to || ''} /></label>
        <label className="field"><span>Zaxira mas’ul (katta buyurtma)</span><Select name="backup_user_id" id="u_backup" defaultValue={u.backup_user_id ?? ''}><option value="">rahbar</option>{users.filter(y => y.id !== u.id && y.active).map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</Select></label>
        <label className="field"><span>Holat</span><Select name="active" id="u_active" defaultValue={u.active ? '1' : '0'}><option value="1">faol</option><option value="0">o‘chirilgan</option></Select></label>
        <label className="field"><span>Parol</span><Select name="reset_password" id="u_reset" defaultValue=""><option value="">o‘zgarmasin</option><option value="1">yangi parol yaratish</option></Select></label>
      </div>
    </div>,
    onSubmit: async d => {
      const r = await api<{ ok?: boolean; error?: string; password?: string }>('/api/users', { ...d, id: u.id, branch_id: Number(d.branch_id) || null, backup_user_id: Number(d.backup_user_id) || null, active: d.active !== '0', reset_password: Boolean(d.reset_password), shift_dow: dowFrom(d, 'dow') });
      if (!r.ok) throw new ApiError(r.error || 'xato', r as any);
      load();
      if (r.password) openModal({ content: <div className="usr-modal"><h2>Bir martalik parol</h2><p className="lead" style={{ fontSize: 13.5 }}>Xodimga bering — boshqa ko‘rsatilmaydi. Kirgach o‘zi o‘zgartiradi.</p><div className="pw-box">{r.password}</div></div> });
    }
  });

  const act = users.filter(u => u.active), canIn = act.filter(u => u.has_pass).length, tg = act.filter(u => u.tg_linked).length;
  const bound = act.filter(u => u.odoo_user_id).length, suggested = Object.keys(odoo.suggestions).length;
  // Odoo menejerlari — panelda hali yo‘q (bog‘lanmagan, ochiq taklifi yo‘q); sukut bo‘yicha faqat lidi borlar
  const candidates = odoo.users.filter(o => !o.staff_id && !o.invite_id && (!onlyLeads || o.leads > 0));
  const withPhone = candidates.filter(o => o.login);
  const odooCell = (u: StaffUser) => {
    const sug = odoo.suggestions[String(u.id)];
    const sugName = sug ? odoo.users.find(x => x.id === sug)?.name : null;
    return (
      <td><div className="odoo">
        <Select value={u.odoo_user_id ?? ''} onChange={e => { void bindOdoo(u, e.target.value ? Number(e.target.value) : null); }} aria-label={`${u.name} — Odoo foydalanuvchisi`}>
          <option value="">— bog‘lanmagan —</option>
          {odoo.users.map(x => <option key={x.id} value={x.id}>{x.name}{x.leads ? ` · ${x.leads} lid` : ''}</option>)}
        </Select>
        {u.odoo_user_id ? <small className="muted"><span className="pill ok">bog‘langan</span>{u.tg_linked ? null : <> · Telegram ulanmagan — xabar rahbarga ketadi</>}</small>
          : sugName ? <small className="muted"><span className="pill warn">taxmin: {sugName}</span> <button className="btn sm" type="button" data-odoo-accept={u.id} onClick={() => { void bindOdoo(u, sug); }}>Bog‘lash</button></small>
          : <small className="muted">Odoo’da shu ismli menejer topilmadi</small>}
      </div></td>
    );
  };
  return (
    <>
      <div className="staff-sum kpis">
        <div className="kpi"><div className="lbl">Xodimlar</div><div className="v">{act.length}</div><div className="s">Paneldagi faol hisoblar</div></div>
        <div className="kpi"><div className="lbl">Panelga kira oladi</div><div className={`v${canIn < act.length ? ' warn' : ''}`}>{canIn}</div><div className="s">{canIn < act.length ? `${act.length - canIn} tasida parol yo‘q` : 'Hammasida parol bor'}</div></div>
        <div className="kpi"><div className="lbl">Telegram ulangan</div><div className={`v${tg < act.length ? ' warn' : ''}`}>{tg}</div><div className="s">{tg < act.length ? `${act.length - tg} tasi bildirishnoma olmaydi` : 'Hammasi bildirishnoma oladi'}</div></div>
        <div className="kpi"><div className="lbl">Odoo’ga bog‘langan</div><div className={`v${bound < act.length ? ' warn' : ''}`}>{bound}</div><div className="s">Nazorat xabari oladi</div></div>
      </div>
      <div className="banner staff-hint"><Icon name="info" /><p className="muted">Eng qisqa yo‘l: pastdagi <b>«Odoo’dagi menejerlar»</b> ro‘yxatidan «Panelga qo‘shish» — xodimga bitta xabar yuborasiz, u havolani ochib parol qo‘yadi va Telegram’ni ulaydi; Odoo bog‘lami o‘zi qo‘yiladi. Alohida ham mumkin: «Kirish havolasi» (parol), «Telegram havola» (xodim {bot ? <a href={`https://t.me/${bot}`} target="_blank" rel="noopener">t.me/{bot}</a> : 'botda'} «Start» bosadi), «Odoo» ustuni (bog‘lam yo‘q bo‘lsa ism bir xil bo‘lganda o‘zi topadi).</p></div>
      <div className="panel"><div className="panel-head"><h2>Filiallar</h2><span className="sub">{b.branches.length} ta</span><div className="right"><button className="btn sm" type="button" data-bnew onClick={() => branchModal({})}><Icon name="plus" />Filial qo‘shish</button></div></div>
        <div className="panel-help">Filial — xodimning ish joyi; sotuvchi faqat o‘z filiali suhbatlarini ko‘radi. Chipni bosib tahrirlanadi.</div>
        <div className="panel-body"><div className="chips">{b.branches.length ? b.branches.map(x => <button className="chip" type="button" key={x.id} data-bedit={x.id} onClick={() => branchModal(x)}>{x.name}{x.kind === 'ombor' ? ' · ombor' : ''}</button>) : <span className="muted">Filial yo‘q</span>}</div></div></div>
      <div className="panel"><div className="panel-head"><h2>Xodimlar</h2><span className="sub">{act.length} ta</span>
        <div className="right">{suggested ? <button className="btn sm" type="button" data-odoo-auto onClick={() => { void autoMatch(); }} title="Ismi Odoo’dagi bilan aynan bir xil xodimlarni bog‘laydi"><Icon name="link" />Odoo: ism bo‘yicha bog‘lash ({suggested})</button> : null}
          <button className="btn sm primary" type="button" data-uinvite onClick={() => invite()}><Icon name="plus" />Xodim qo‘shish</button></div></div>
        <div className="panel-help">Kirish — parol bormi; Telegram — bot ulanganmi; Odoo — qaysi menejer. Qatordagi tugmalar darhol ishlaydi.{!odoo.users.length ? <> Odoo foydalanuvchilari hali sinxronlanmagan — «AI agent» bo‘limida Odoo holatini tekshiring.</> : null}</div>
        <div className="tbl"><table className="staff"><thead><tr><th>Ism</th><th>Login (telefon)</th><th>Rol</th><th>Filial</th><th>Smena</th><th>Kirish</th><th>Telegram</th><th>Odoo</th><th><span className="sr-only">Amallar</span></th></tr></thead><tbody>
          {users.map(u => (
            <tr key={u.id} className={u.active ? undefined : 'off'}><td className="who">{u.name}</td><td className="mono">{u.login}</td><td>{ROLE[u.role]}</td>
              <td className={u.branch_id ? undefined : 'muted'}>{b.branches.find(x => x.id === u.branch_id)?.name || '—'}</td><td className="shift">{shiftText(u)}</td>
              <td><div className="cell-stack row-actions">{u.has_pass ? <span className="pill ok">kira oladi</span> : <span className="pill warn">parol yo‘q</span>}
                <button className={`btn sm ${u.has_pass ? 'ghost' : 'primary'}`} type="button" data-ulink={u.id} onClick={() => resetLink(u)}>{u.has_pass ? 'Parolni o‘zgartirish' : 'Kirish havolasi'}</button></div></td>
              <td>{u.tg_linked ? <div className="cell-stack"><span className="pill ok">ulangan</span>{u.tg_username ? <small className="muted">@{u.tg_username}</small> : null}</div>
                : u.tg_username || u.tg_user_id ? <div className="cell-stack"><span className="pill warn" title="Xodim botda «Start» bosishi kerak">Start kutilmoqda</span><small className="muted">{u.tg_username ? '@' + u.tg_username : 'ID ' + u.tg_user_id}</small></div>
                : <button className="btn sm" type="button" data-tglink={u.id} onClick={() => tgLink(u)}><Icon name="send" />Telegram havola</button>}</td>
              {odooCell(u)}
              <td className="act-end"><div className="acts row-actions"><button className="btn sm ghost" type="button" data-uedit={u.id} onClick={() => editUser(u)}>Tahrirlash</button><button className="btn sm ghost danger" type="button" data-udel={u.id} title="Ro‘yxatdan o‘chiradi — tarix qoladi" onClick={() => delUser(u)}>O‘chirish</button></div></td></tr>
          ))}
        </tbody></table></div></div>
      {invites.items.length ? <div className="panel"><div className="panel-head"><h2>Kutayotgan takliflar</h2><span className="sub">{invites.items.length} ta</span></div>
        <div className="panel-help">Havola berilgan, xodim hali parol qo‘ymagan. «Xabar» — tayyor matn, uni Telegram’da yuborasiz.</div>
        <div className="tbl"><table><thead><tr><th>Ism</th><th>Login</th><th>Lavozim</th><th>Filial</th><th>Muddati</th><th><span className="sr-only">Amallar</span></th></tr></thead><tbody>
          {invites.items.map(i => (
            <tr key={i.id}><td><div className="who-2"><b>{i.name}{i.kind === 'reset' ? <> <span className="pill warn">parol almashtirish</span></> : null}</b>{i.odoo_name ? <small className="muted">Odoo: {i.odoo_name}</small> : null}</div></td><td className="mono">{i.login}</td><td>{ROLE[i.role]}</td><td>{i.branch_name || '—'}</td>
              <td className="mono">{fmtDT(i.expires_at)} gacha</td>
              <td className="act-end"><div className="acts row-actions">{i.kind !== 'reset' ? <button className="btn sm primary" type="button" data-invmsg={i.id} onClick={() => openModal({ content: <MessageBox title="Xodimga xabar" intro={<><b>{i.name}</b> ga Telegram’da yuboring.</>} messages={[{ name: i.name, login: i.login, text: inviteMsg(i.name, `${invites.base}/taklif?k=${i.token}`) }]} /> })}><Icon name="send" />Xabar</button> : null}
                <button className="btn sm" type="button" data-invcopy onClick={() => copyInvite(`${invites.base}/taklif?k=${i.token}`)}><Icon name="copy" />Havolani nusxalash</button>
                <button className="btn sm ghost" type="button" data-invdel={i.id} onClick={() => revoke(i.id)}>Bekor qilish</button></div></td></tr>
          ))}
        </tbody></table></div></div> : null}
      {odoo.users.length ? <div className="panel"><div className="panel-head"><h2>Odoo’dagi menejerlar</h2><span className="sub">{candidates.length} ta</span>
        <div className="right"><label className="check"><input type="checkbox" checked={onlyLeads} onChange={e => setOnlyLeads(e.target.checked)} data-odoo-onlyleads />faqat lidi borlar</label>
        {withPhone.length ? <button className="btn sm primary" type="button" data-odoo-bulk onClick={() => { void bulkInvite(withPhone.map(o => o.id)); }} title="Telefoni borlarning hammasiga taklif havolasi yaratadi"><Icon name="send" />Telefoni borlarni taklif qilish ({withPhone.length})</button> : null}</div></div>
        <div className="panel-help">Odoo’da bor, panelda hali yo‘q{withPhone.length < candidates.length ? ` — ${candidates.length - withPhone.length} tasida Odoo’da telefon yo‘q` : ''}. Telefoni borlarni bir bosishda taklif qilish mumkin; telefonsizga «Panelga qo‘shish»da raqam kiritiladi.</div>
        {candidates.length ? <div className="tbl"><table><thead><tr><th>Ism (Odoo)</th><th className="n">Lid</th><th>Telefon (login bo‘ladi)</th><th><span className="sr-only">Amal</span></th></tr></thead><tbody>
          {candidates.map(o => (
            <tr key={o.id}><td className="who">{o.name}</td><td className="n mono">{o.leads}</td>
              <td>{o.login ? <span className="mono">{o.login}</span> : <span className="pill warn" title="Odoo’da telefon yo‘q yoki noto‘g‘ri — qo‘shishda qo‘lda kiritasiz">telefon yo‘q</span>}{o.phone && !o.login ? <small className="muted">{o.phone}</small> : null}</td>
              <td className="act-end"><button className="btn sm" type="button" data-odoo-invite={o.id} onClick={() => invite({ name: o.name, phone: o.phone || '', role: 'sotuvchi', odoo_user_id: o.id })}><Icon name="plus" />Panelga qo‘shish</button></td></tr>
          ))}
        </tbody></table></div> : <p className="panel-body muted">{onlyLeads ? 'Lidi bor hamma menejer panelda bor yoki taklif kutmoqda.' : 'Hamma Odoo foydalanuvchisi panelda bor yoki taklif kutmoqda.'}</p>}</div> : null}
      {billz.length ? <div className="panel"><div className="panel-head"><h2>BILLZ’dagi xodimlar</h2><span className="sub">{billz.length} ta</span></div>
        <div className="panel-help">Panelda hali yo‘q. Ism BILLZ’dagidek qoladi.</div>
        <div className="tbl"><table><thead><tr><th>Ism</th><th>BILLZ roli</th><th>Asosiy filial</th><th className="n">Chek, 90 kun</th><th><span className="sr-only">Amal</span></th></tr></thead><tbody>
          {billz.map((x, i) => (
            <tr key={i}><td className="who">{x.name}</td><td className="muted">{x.roles.join(', ') || '—'}</td><td>{x.branch || '—'}</td><td className="n mono">{x.checks_90d}</td>
              <td className="act-end"><button className="btn sm" type="button" data-uinvite onClick={() => invite({ name: x.name, login: x.login, branch_id: x.branch_id, role: 'sotuvchi' })}><Icon name="plus" />Panelga qo‘shish</button></td></tr>
          ))}
        </tbody></table></div></div> : null}
    </>
  );
}
