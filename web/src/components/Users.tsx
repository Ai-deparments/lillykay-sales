'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
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
interface OdooBind { users: { id: number; name: string; leads: number }[]; suggestions: Record<string, number> }
interface Invite { id: number; name: string; login: string; role: string; branch_name?: string; kind?: string; expires_at: number; token: string }
interface BillzStaff { name: string; roles: string[]; branch?: string; checks_90d: number; login?: string; branch_id?: number | null }
interface Prefill { name?: string; login?: string; branch_id?: number | null; role?: string }

/* Havola ko‘rsatiladigan oyna tarkibi (nusxalash tugmasi bilan) */
function LinkBox({ title, text, link }: { title?: string; text: React.ReactNode; link: string }) {
  const { toast } = useApp();
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast('Havola nusxalandi'); } catch { toast('Havolani qo‘lda nusxalang'); } };
  return (
    <>
      <h2>{title || 'Havola tayyor'}</h2>
      <p className="lead" style={{ fontSize: 13 }}>{text}</p>
      <div className="pw-box" style={{ wordBreak: 'break-all', fontSize: 13 }}>{link}</div>
      <div className="row-actions"><button className="btn primary" type="button" id="invCopy2" onClick={copy}>Havolani nusxalash</button></div>
    </>
  );
}

function BranchForm({ x }: { x: Partial<Branch> }) {
  return (
    <>
      <h2>{x.id ? 'Filial' : 'Yangi filial'}</h2>
      <div className="form-grid"><label className="field"><span>Nomi</span><input name="name" id="b_name" defaultValue={x.name || ''} required /></label>
        <label className="field wide"><span>Ish kunlari</span><DowBoxes val={x.work_dow} pre="wd" /></label>
        <label className="field"><span>Ochilish</span><input type="time" name="open_from" id="b_of" defaultValue={x.open_from || ''} /></label>
        <label className="field"><span>Yopilish</span><input type="time" name="open_to" id="b_ot" defaultValue={x.open_to || ''} /></label>
        <label className="field"><span>Turi</span><Select name="kind" id="b_kind" defaultValue={x.kind === 'ombor' ? 'ombor' : 'dokon'}><option value="dokon">do‘kon (mijoz shu yerda oladi)</option><option value="ombor">ombor</option></Select></label>
        <label className="field wide"><span>Izoh</span><input name="note" id="b_note" defaultValue={x.note || ''} /></label></div>
    </>
  );
}

export function Users({ active }: { active: boolean }) {
  const { boot: b, reloadBoot, toast, fail, openModal } = useApp();
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const [invites, setInvites] = useState<{ items: Invite[]; base: string }>({ items: [], base: '' });
  const [billz, setBillz] = useState<BillzStaff[]>([]);
  const [odoo, setOdoo] = useState<OdooBind>({ users: [], suggestions: {} });

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
    content: <>
      <h2>Havola bilan xodim qo‘shish</h2>
      <p className="lead" style={{ fontSize: 13 }}>Xodimga havola yuboriladi. U havolani ochib, <b>o‘zi parol qo‘yadi</b> va o‘ziga berilgan lavozimda darhol kiradi — parol sizdan ham, yozishmadan ham o‘tmaydi. Panelga <b>telefon raqami bilan</b> kiradi.</p>
      <div className="grid-2">
        <label className="field"><span>Ism familiya</span><input name="name" required maxLength={80} defaultValue={pf.name || ''} /></label>
        <label className="field"><span>Lavozim</span><Select name="role" defaultValue={pf.role || 'sotuvchi'}>
          <option value="sotuvchi">Sotuvchi</option><option value="filial">Filial rahbari</option>
          {canAdmin ? <><option value="rahbar">Rahbar</option><option value="admin">Administrator</option></> : null}</Select></label>
        <label className="field"><span>Filial</span><Select name="branch_id" defaultValue={pf.branch_id ?? ''}><option value="">—</option>
          {b.branches.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
        <label className="field"><span>Telefon raqami — shu login bo‘ladi</span><input name="phone" type="tel" inputMode="tel" required placeholder="+998 90 123 45 67" title="Xodim shu raqam bilan panelga kiradi" /></label>
        <label className="field"><span>Havola amal qiladi</span><Select name="days" defaultValue="7"><option value="3">3 kun</option><option value="7">7 kun</option><option value="30">30 kun</option></Select></label>
      </div>
    </>,
    onSubmit: async data => {
      const r = await api<{ link: string }>('/api/invites', data);
      await load();
      openModal({ content: <LinkBox text={<><b>{data.name}</b> ga shu havolani yuboring. Havola bir marta ishlaydi.</>} link={r.link} /> });
    }
  });
  const copyInvite = async (link: string) => {
    try { await navigator.clipboard.writeText(link); toast('Havola nusxalandi'); }
    catch { openModal({ content: <><h2>Havola</h2><div className="pw-box" style={{ wordBreak: 'break-all', fontSize: 13 }}>{link}</div></> }); }
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
    openModal({ content: <><h2>Telegram bildirishnomalari</h2>{r.link ? <><p className="lead" style={{ fontSize: 13.5 }}>Xodim shu havolani Telegram’da ochib «Start» bosadi (1 soat amal qiladi):</p><div className="pw-box" style={{ fontSize: 13 }}>{r.link}</div></>
      : <div className="banner warn">Bot hali ulanmagan (token kiritilmagan). Token kiritilgach havola shu yerda chiqadi.</div>}</> });
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
    content: <>
      <h2>Xodim</h2><div className="form-grid">
        <label className="field"><span>Ism</span><input name="name" id="u_name" defaultValue={u.name || ''} required /></label>
        <label className="field"><span>Login (lotin)</span><input name="login" id="u_login" defaultValue={u.login || ''} readOnly required /></label>
        <label className="field"><span>Rol</span><Select name="role" id="u_role" defaultValue={u.role}>{Object.entries(ROLE).filter(([k]) => k !== 'admin' || b.me.role === 'admin').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></label>
        <label className="field"><span>Filial</span><Select name="branch_id" id="u_branch" defaultValue={u.branch_id ?? ''}><option value="">—</option>{b.branches.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
        <label className="field"><span>Telefon</span><input name="phone" id="u_phone" defaultValue={u.phone || ''} /></label>
        <label className="field"><span>Telegram username</span><input name="tg_username" id="u_tgname" defaultValue={u.tg_username ? '@' + u.tg_username : ''} placeholder="@hilola_photobuy" autoCapitalize="off" spellCheck={false} /></label>
        <label className="field"><span>Telegram ID (ixtiyoriy)</span><input name="tg_user_id" id="u_tgid" defaultValue={u.tg_user_id ?? ''} inputMode="numeric" placeholder="123456789" /></label>
        <p className="muted" style={{ fontSize: 12.5, margin: 0, gridColumn: '1/-1' }}>Tizim xodimni shu username/ID bo‘yicha taniydi: u Photobuy akkauntiga yozsa — mijoz emas, sotuvchi deb biladi (AI unga mijozdek javob bermaydi). Har kuni ish boshida Photobuy akkauntiga «Salom» deb yozsa, topshiriqlar rahbar nomidan shu akkauntdan keladi; zaxira yo‘l — <b>@{bot || 'bot'}</b> da bir marta «Start».</p>
        <label className="field wide"><span>Ish kunlari (smena)</span><DowBoxes val={u.shift_dow} pre="dow" /></label>
        <label className="field"><span>Smena boshi</span><input type="time" name="shift_from" id="u_sf" defaultValue={u.shift_from || ''} /></label>
        <label className="field"><span>Smena oxiri</span><input type="time" name="shift_to" id="u_st" defaultValue={u.shift_to || ''} /></label>
        <label className="field"><span>Zaxira mas’ul (katta buyurtma)</span><Select name="backup_user_id" id="u_backup" defaultValue={u.backup_user_id ?? ''}><option value="">rahbar</option>{users.filter(y => y.id !== u.id && y.active).map(y => <option key={y.id} value={y.id}>{y.name}</option>)}</Select></label>
        <label className="field"><span>Holat</span><Select name="active" id="u_active" defaultValue={u.active ? '1' : '0'}><option value="1">faol</option><option value="0">o‘chirilgan</option></Select></label>
        <label className="field"><span>Parol</span><Select name="reset_password" id="u_reset" defaultValue=""><option value="">o‘zgarmasin</option><option value="1">yangi parol yaratish</option></Select></label>
      </div>
    </>,
    onSubmit: async d => {
      const r = await api<{ ok?: boolean; error?: string; password?: string }>('/api/users', { ...d, id: u.id, branch_id: Number(d.branch_id) || null, backup_user_id: Number(d.backup_user_id) || null, active: d.active !== '0', reset_password: Boolean(d.reset_password), shift_dow: dowFrom(d, 'dow') });
      if (!r.ok) throw new ApiError(r.error || 'xato', r as any);
      load();
      if (r.password) openModal({ content: <><h2>Bir martalik parol</h2><p className="lead" style={{ fontSize: 13.5 }}>Xodimga bering — boshqa ko‘rsatilmaydi. Kirgach o‘zi o‘zgartiradi.</p><div className="pw-box">{r.password}</div></> });
    }
  });

  const act = users.filter(u => u.active), canIn = act.filter(u => u.has_pass).length, tg = act.filter(u => u.tg_linked).length;
  const bound = act.filter(u => u.odoo_user_id).length, suggested = Object.keys(odoo.suggestions).length;
  const odooCell = (u: StaffUser) => {
    const sug = odoo.suggestions[String(u.id)];
    const sugName = sug ? odoo.users.find(x => x.id === sug)?.name : null;
    return (
      <td style={{ minWidth: 200 }}>
        <Select value={u.odoo_user_id ?? ''} onChange={e => { void bindOdoo(u, e.target.value ? Number(e.target.value) : null); }} aria-label={`${u.name} — Odoo foydalanuvchisi`}>
          <option value="">— bog‘lanmagan —</option>
          {odoo.users.map(x => <option key={x.id} value={x.id}>{x.name}{x.leads ? ` · ${x.leads} lid` : ''}</option>)}
        </Select>
        {u.odoo_user_id ? <div className="muted" style={{ fontSize: 12 }}><span className="pill ok">bog‘langan</span>{u.tg_linked ? null : <> · Telegram ulanmagan — xabar rahbarga ketadi</>}</div>
          : sugName ? <div className="muted" style={{ fontSize: 12 }}><span className="pill warn">taxmin: {sugName}</span> <button className="btn sm" type="button" data-odoo-accept={u.id} onClick={() => { void bindOdoo(u, sug); }}>Bog‘lash</button></div>
          : <div className="muted" style={{ fontSize: 12 }}>Odoo’da shu ismli menejer topilmadi</div>}
      </td>
    );
  };
  return (
    <>
      <div className="panel"><div className="panel-head"><h2>Filiallar</h2><button className="btn sm" type="button" data-bnew onClick={() => branchModal({})}>Filial qo‘shish</button></div>
        <div className="chips">{b.branches.length ? b.branches.map(x => <button className="chip" type="button" key={x.id} data-bedit={x.id} onClick={() => branchModal(x)}>{x.name}{x.kind === 'ombor' ? ' · ombor' : ''}</button>) : <span className="muted">Filial yo‘q</span>}</div></div>
      <div className="staff-sum"><div><b>{act.length}</b><span>xodim</span></div><div className={canIn < act.length ? 'warn' : ''}><b>{canIn}</b><span>panelga kira oladi</span></div>
        <div className={tg < act.length ? 'warn' : ''}><b>{tg}</b><span>Telegram’ga ulangan — bildirishnoma oladi</span></div>
        <div className={bound < act.length ? 'warn' : ''}><b>{bound}</b><span>Odoo menejeriga bog‘langan — Nazorat xabari oladi</span></div>
        <p className="muted">Xodim ishlashi uchun 3 qadam: <b>1)</b> «Kirish havolasi» — login va parolni unga yuboring; <b>2)</b> Telegram: xodim {bot ? <a href={`https://t.me/${bot}`} target="_blank" rel="noopener">t.me/{bot}</a> : 'botda'} «Start» bosadi — bildirishnomalar unga keladi; <b>3)</b> «Odoo» ustunida uning Odoo foydalanuvchisini tanlang — Nazorat ogohlantirishlari va lid kartasidagi «Panelda» shunga qaraydi (bog‘lam yo‘q bo‘lsa ism bir xil bo‘lganda o‘zi topadi).</p></div>
      <div className="panel"><div className="panel-head"><h2>Xodimlar</h2><button className="btn sm primary" type="button" data-uinvite onClick={() => invite()}>Xodim qo‘shish</button>
        {suggested ? <button className="btn sm" type="button" data-odoo-auto onClick={() => { void autoMatch(); }} title="Ismi Odoo’dagi bilan aynan bir xil xodimlarni bog‘laydi">Odoo: ism bo‘yicha bog‘lash ({suggested})</button> : null}
        {!odoo.users.length ? <span className="muted">Odoo foydalanuvchilari hali sinxronlanmagan — «AI agent» bo‘limida Odoo holatini tekshiring</span> : null}</div>
        <div className="tbl"><table><thead><tr><th>Ism</th><th>Login (telefon)</th><th>Rol</th><th>Filial</th><th>Smena</th><th>Kirish</th><th>Telegram</th><th>Odoo</th><th></th></tr></thead><tbody>
          {users.map(u => (
            <tr key={u.id} style={u.active ? undefined : { opacity: 0.5 }}><td>{u.name}</td><td className="mono">{u.login}</td><td>{ROLE[u.role]}</td>
              <td>{b.branches.find(x => x.id === u.branch_id)?.name || '—'}</td><td className="muted" style={{ fontSize: 12.5 }}>{shiftText(u)}</td>
              <td className="row-actions">{u.has_pass ? <span className="pill ok">kira oladi</span> : <span className="pill warn">parol yo‘q</span>}
                <button className={`btn sm ${u.has_pass ? 'ghost' : 'primary'}`} type="button" data-ulink={u.id} onClick={() => resetLink(u)}>{u.has_pass ? 'Parolni o‘zgartirish' : 'Kirish havolasi'}</button></td>
              <td>{u.tg_linked ? <><span className="pill ok">ulangan</span>{u.tg_username ? <div className="muted" style={{ fontSize: 12 }}>@{u.tg_username}</div> : null}</>
                : u.tg_username || u.tg_user_id ? <><span className="pill warn" title="Xodim botda «Start» bosishi kerak">Start kutilmoqda</span><div className="muted" style={{ fontSize: 12 }}>{u.tg_username ? '@' + u.tg_username : 'ID ' + u.tg_user_id}</div></>
                : <button className="btn sm" type="button" data-tglink={u.id} onClick={() => tgLink(u)}>Telegram havola</button>}</td>
              {odooCell(u)}
              <td className="row-actions"><button className="btn sm ghost" type="button" data-uedit={u.id} onClick={() => editUser(u)}>Tahrirlash</button><button className="btn sm ghost" type="button" data-udel={u.id} title="Ro‘yxatdan o‘chiradi — tarix qoladi" onClick={() => delUser(u)}>O‘chirish</button></td></tr>
          ))}
        </tbody></table></div></div>
      {invites.items.length ? <div className="panel"><div className="panel-head"><h2>Kutayotgan takliflar</h2><span className="muted">Havola berilgan — xodim hali parol qo‘ymagan</span></div>
        <div className="tbl"><table><thead><tr><th>Ism</th><th>Login</th><th>Lavozim</th><th>Filial</th><th>Muddati</th><th></th></tr></thead><tbody>
          {invites.items.map(i => (
            <tr key={i.id}><td>{i.name}{i.kind === 'reset' ? <> <span className="pill warn">parol almashtirish</span></> : null}</td><td className="mono">{i.login}</td><td>{ROLE[i.role]}</td><td>{i.branch_name || '—'}</td>
              <td className="muted">{fmtDT(i.expires_at)} gacha</td>
              <td className="row-actions"><button className="btn sm" type="button" data-invcopy onClick={() => copyInvite(`${invites.base}/taklif?k=${i.token}`)}>Havolani nusxalash</button>
                <button className="btn sm ghost" type="button" data-invdel={i.id} onClick={() => revoke(i.id)}>Bekor qilish</button></td></tr>
          ))}
        </tbody></table></div></div> : null}
      {billz.length ? <div className="panel"><div className="panel-head"><h2>BILLZ’dagi xodimlar</h2><span className="muted">Panelda hali yo‘q. Ism BILLZ’dagidek qoladi</span></div>
        <div className="tbl"><table><thead><tr><th>Ism</th><th>BILLZ roli</th><th>Asosiy filial</th><th className="n">Chek, 90 kun</th><th></th></tr></thead><tbody>
          {billz.map((x, i) => (
            <tr key={i}><td>{x.name}</td><td className="muted">{x.roles.join(', ') || '—'}</td><td>{x.branch || '—'}</td><td className="n mono">{x.checks_90d}</td>
              <td><button className="btn sm" type="button" data-uinvite onClick={() => invite({ name: x.name, login: x.login, branch_id: x.branch_id, role: 'sotuvchi' })}>Panelga qo‘shish</button></td></tr>
          ))}
        </tbody></table></div></div> : null}
    </>
  );
}
