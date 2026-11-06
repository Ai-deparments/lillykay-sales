// dropdown.js — paketsiz, freymvorksiz custom dropdown (select / combobox / multi).
// Brauzerda: import { dropdown, enhanceSelect } from './dropdown.js'
// Node'da (test): norm, filterOptions — DOM'ga tegmaydi.
// Uslub: dropdown.css, variant — data-v="<id>" (history/HISTORY.md dagi g'olib).
// O'ZGARISH (Photobuy): cfg.float — panel position:fixed bilan trigger ostiga (yoki tepasiga) joylanadi, modal/overflow ichida kesilmaydi.

// ---------- Sof funksiyalar ----------
const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

// Lotin va kirill bir xil kalitga keladi: "Тошкент" = "toshkent", "Oʻzbekiston" = "Ўзбекистон".
export function norm(s) {
  const low = String(s ?? '').toLowerCase().replace(/[ʻʼ'`‘’]/g, '');
  let out = '';
  for (const ch of low) out += ch in CYR ? CYR[ch] : ch;
  return out.replace(/\s+/g, ' ').trim();
}

// So'zlar bo'yicha qidiruv: hamma so'z topilishi kerak, boshidan mos kelganlar oldinda.
// 15 ming qatorda ham faqat `limit` tasi chiziladi — `total` "yana N ta" uchun.
export function filterOptions(options, query, limit = 200) {
  const q = norm(query);
  if (!q) return { items: options.slice(0, limit), total: options.length };
  const words = q.split(' ');
  const head = [], tail = [];
  let total = 0;
  for (const o of options) {
    if (o._n === undefined) o._n = norm(`${o.label} ${o.desc || ''} ${o.keywords || ''}`);
    if (!words.every((w) => o._n.includes(w))) continue;
    total++;
    if (head.length + tail.length >= limit && !o._n.startsWith(q)) continue;
    (o._n.startsWith(q) ? head : tail).push(o);
  }
  return { items: head.concat(tail).slice(0, limit), total };
}

// ---------- DOM ----------
const NS = 'http://www.w3.org/2000/svg';
const ICON = {
  chev: 'M6 9l6 6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2',
};
let uid = 0;

function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  if (text != null) n.textContent = text;
  return n;
}
function svg(d, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', cls);
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}
// Topilgan qismni <mark> bilan ajratadi (faqat to'g'ridan-to'g'ri moslikda; innerHTML yo'q).
function mark(label, q) {
  const t = String(q || '').trim().toLowerCase();
  const i = t ? label.toLowerCase().indexOf(t) : -1;
  const f = document.createDocumentFragment();
  if (i < 0) { f.append(label); return f; }
  f.append(label.slice(0, i), el('mark', {}, label.slice(i, i + t.length)), label.slice(i + t.length));
  return f;
}
function initials(s) {
  return String(s).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
function lead(x) {
  if (x.color) { const d = el('span', { class: 'dd-dot', 'aria-hidden': 'true' }); d.style.background = x.color; return d; }
  if (x.avatar) return el('span', { class: 'dd-av', 'aria-hidden': 'true' }, initials(x.label));
  if (x.icon) return svg(x.icon, 'dd-ic');
  return null;
}

/**
 * dropdown(host, cfg) — host ichiga dropdown qo'yadi.
 * cfg: { options:[{value,label,desc?,group?,icon?(svg path),color?,avatar?,hint?,disabled?,keywords?}],
 *        value, multi, search, label, placeholder, searchPlaceholder, variant, sheet, limit, onChange(value) }
 */
export function dropdown(host, cfg = {}) {
  const id = `dd${++uid}`;
  const o = {
    options: [], multi: false, search: false, label: '', placeholder: 'Tanlang',
    searchPlaceholder: 'Qidirish…', variant: 'pill', sheet: true, limit: 200, onChange() {}, ...cfg,
  };
  let value = o.multi ? new Set(o.value || []) : (o.value ?? null);
  let open = false, active = -1, shown = [], typed = '', typedAt = 0, raf = 0;
  const isSel = (x) => (o.multi ? value.has(x.value) : x.value === value);

  const root = el('div', { class: 'dd', 'data-v': o.variant });
  const btn = el('button', {
    type: 'button', class: 'dd-trigger', id: `${id}-b`, 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
    'aria-controls': `${id}-lb`, 'aria-labelledby': o.label ? `${id}-l ${id}-b` : null,
  });
  const val = el('span', { class: 'dd-value' });
  btn.append(val, svg(ICON.chev, 'dd-chev'));

  const panel = el('div', { class: 'dd-panel', hidden: true });
  let input = null;
  if (o.search) {
    const box = el('div', { class: 'dd-search' });
    input = el('input', {
      type: 'text', class: 'dd-input', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': `${id}-lb`,
      'aria-autocomplete': 'list', 'aria-label': `${o.label || 'Ro‘yxat'} — qidirish`,
      placeholder: o.searchPlaceholder, autocomplete: 'off', spellcheck: 'false',
    });
    box.append(svg(ICON.search, 'dd-sic'), input);
    if (o.searchHint) box.append(el('kbd', {}, o.searchHint));
    panel.append(box);
  }
  const list = el('ul', {
    class: 'dd-list', role: 'listbox', id: `${id}-lb`, tabindex: '-1',
    'aria-labelledby': o.label ? `${id}-l` : null, 'aria-label': o.label ? null : o.placeholder,
    'aria-multiselectable': o.multi ? 'true' : null,
  });
  const foot = el('div', { class: 'dd-foot' });
  const live = el('span', { class: 'dd-sr', 'aria-live': 'polite' });
  panel.append(list, foot, live);
  const backdrop = el('div', { class: 'dd-backdrop', hidden: true });
  root.append(btn, panel, backdrop);
  if (o.label) host.append(el('span', { class: 'dd-label', id: `${id}-l` }, o.label));
  host.append(root);

  const clearBtn = el('button', { type: 'button', class: 'dd-btn' }, 'Tozalash');
  const doneBtn = el('button', { type: 'button', class: 'dd-btn dd-btn-pri' }, 'Tayyor');
  clearBtn.addEventListener('click', () => { value.clear(); renderList(); renderValue(); emit(); });
  doneBtn.addEventListener('click', () => close(true));

  function renderValue() {
    val.replaceChildren();
    if (o.multi) {
      const sel = o.options.filter((x) => value.has(x.value));
      if (!sel.length) return val.append(el('span', { class: 'dd-ph' }, o.placeholder));
      sel.slice(0, 2).forEach((x) => val.append(el('span', { class: 'dd-chip' }, x.label)));
      if (sel.length > 2) val.append(el('span', { class: 'dd-more' }, `+${sel.length - 2}`));
      return;
    }
    const x = o.options.find((y) => y.value === value);
    if (!x) return val.append(el('span', { class: 'dd-ph' }, o.placeholder));
    const l = lead(x);
    if (l) val.append(l);
    val.append(el('span', { class: 'dd-vt' }, x.label));
  }

  function renderList() {
    const q = input ? input.value : '';
    const r = filterOptions(o.options, q, o.limit);
    shown = r.items;
    list.replaceChildren();
    let group;
    shown.forEach((x, i) => {
      if (x.group && x.group !== group) {
        group = x.group;
        list.append(el('li', { class: 'dd-group', role: 'presentation' }, group));
      }
      const li = el('li', {
        class: 'dd-opt', role: 'option', id: `${id}-o${i}`, 'data-i': i,
        'aria-selected': String(isSel(x)), 'aria-disabled': x.disabled ? 'true' : null,
      });
      li.append(svg(ICON.check, 'dd-check'));
      const l = lead(x);
      if (l) li.append(l);
      const t = el('span', { class: 'dd-t' });
      const main = el('span', { class: 'dd-tl' });
      main.append(mark(x.label, q));
      t.append(main);
      if (x.desc) t.append(el('small', {}, x.desc));
      li.append(t);
      if (x.hint) li.append(el('kbd', {}, x.hint));
      list.append(li);
    });
    if (!shown.length) list.append(el('li', { class: 'dd-empty', role: 'presentation' }, 'Hech narsa topilmadi'));
    foot.replaceChildren();
    const rest = r.total - shown.length;
    if (rest > 0) foot.append(el('span', { class: 'dd-rest' }, `Yana ${rest.toLocaleString('ru-RU')} ta — qidiruvni aniqlang`));
    if (o.multi) {
      const gap = el('span', { class: 'dd-fill' });
      foot.append(gap, clearBtn, doneBtn);
    }
    foot.hidden = !foot.childNodes.length;
    live.textContent = q ? `${r.total} ta natija` : '';
    const sel = shown.findIndex(isSel);
    setActive(sel >= 0 ? sel : 0, false);
    if (open) place();
  }

  function setActive(i, scroll = true) {
    if (!shown.length) { active = -1; (input || list).removeAttribute('aria-activedescendant'); return; }
    i = Math.max(0, Math.min(shown.length - 1, i));
    list.querySelector('.is-active')?.classList.remove('is-active');
    active = i;
    const li = list.querySelector(`#${id}-o${i}`);
    li?.classList.add('is-active');
    (input || list).setAttribute('aria-activedescendant', `${id}-o${i}`);
    if (scroll) li?.scrollIntoView({ block: 'nearest' });
  }
  function move(d) {
    if (!shown.length) return;
    let i = active;
    for (let n = 0; n < shown.length; n++) {
      i = Math.max(0, Math.min(shown.length - 1, i + d));
      if (!shown[i].disabled) break;
    }
    setActive(i);
  }

  function emit() { o.onChange(o.multi ? [...value] : value); }
  function choose(i) {
    const x = shown[i];
    if (!x || x.disabled) return;
    if (o.multi) {
      value.has(x.value) ? value.delete(x.value) : value.add(x.value);
      list.querySelector(`#${id}-o${i}`)?.setAttribute('aria-selected', String(value.has(x.value)));
      setActive(i);
    } else {
      value = x.value;
      close(true);
    }
    renderValue();
    emit();
  }

  // float: panel fixed — trigger koordinatalari bo'yicha; joy bo'lmasa tepaga (bottom bilan: ro'yxat qisqarsa ham trigger'ga yopishgan qoladi)
  function place() {
    if (!o.float || root.classList.contains('is-sheet')) return;
    const r = btn.getBoundingClientRect(), pad = o.floatPad || 0;
    panel.style.position = 'fixed';
    panel.style.left = `${r.left - pad}px`;
    panel.style.right = 'auto';
    panel.style.width = `${r.width + pad * 2}px`;
    const h = panel.offsetHeight, below = innerHeight - r.bottom;
    const up = below < h + 14 && r.top > below;
    root.classList.toggle('is-up', up);
    if (up) { panel.style.top = 'auto'; panel.style.bottom = `${innerHeight - r.top + 6}px`; }
    else { panel.style.bottom = 'auto'; panel.style.top = `${r.bottom + 6}px`; }
  }
  const onScroll = (e) => { if (!panel.contains(e.target)) close(false); };

  function openPanel() {
    if (open) return;
    open = true;
    const sheet = o.sheet && matchMedia('(max-width: 640px)').matches;
    root.classList.toggle('is-sheet', sheet);
    root.classList.remove('is-up');
    backdrop.hidden = !sheet;
    panel.hidden = false;
    root.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    if (input) input.value = '';
    renderList();
    if (o.float) {
      place();
      addEventListener('resize', place);
      document.addEventListener('scroll', onScroll, true);
    } else if (!sheet) {
      const r = panel.getBoundingClientRect();
      if (r.bottom > innerHeight - 8 && btn.getBoundingClientRect().top > r.height + 16) root.classList.add('is-up');
    }
    (input || list).focus({ preventScroll: true });
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    document.addEventListener('pointerdown', outside, true);
  }
  function close(focusBtn) {
    if (!open) return;
    open = false;
    panel.hidden = true;
    backdrop.hidden = true;
    root.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (o.float) {
      removeEventListener('resize', place);
      document.removeEventListener('scroll', onScroll, true);
      panel.removeAttribute('style');
    }
    if (focusBtn) btn.focus();
  }
  function outside(e) { if (!root.contains(e.target) || e.target === backdrop) close(false); }

  btn.addEventListener('click', () => (open ? close(true) : openPanel()));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openPanel(); }
  });
  backdrop.addEventListener('click', () => close(true));
  input?.addEventListener('input', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderList); });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.dd-opt');
    if (li) choose(Number(li.dataset.i));
  });
  list.addEventListener('pointermove', (e) => {
    const li = e.target.closest('.dd-opt');
    if (li && Number(li.dataset.i) !== active) setActive(Number(li.dataset.i), false);
  });
  panel.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (k === 'PageDown') { e.preventDefault(); move(10); }
    else if (k === 'PageUp') { e.preventDefault(); move(-10); }
    else if ((k === 'Home' || k === 'End') && !input) { e.preventDefault(); setActive(k === 'Home' ? 0 : shown.length - 1); }
    else if (k === 'Enter' && e.target !== clearBtn && e.target !== doneBtn) { e.preventDefault(); choose(active); }
    else if (k === ' ' && !input && e.target === list) { e.preventDefault(); choose(active); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (k === 'Tab' && !o.multi) close(false);
    else if (!input && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typeahead: harf terilsa shu harf bilan boshlanadigan variantga o'tadi.
      const now = Date.now();
      typed = now - typedAt > 700 ? k : typed + k;
      typedAt = now;
      const q = norm(typed);
      const n = shown.length;
      const start = typed.length > 1 ? active : active + 1; // yangi harf — keyingisidan, davomi — joriydan
      for (let s = 0; s < n; s++) {
        const i = (start + s + n) % n;
        if (norm(shown[i].label).startsWith(q)) { setActive(i); break; }
      }
    }
  });

  renderValue();
  return {
    el: root,
    get value() { return o.multi ? [...value] : value; },
    set(v) { value = o.multi ? new Set(v || []) : v; renderValue(); if (open) renderList(); },
    setOptions(opts) { o.options = opts; renderValue(); if (open) renderList(); },
    open: openPanel,
    close: () => close(false),
  };
}

/**
 * enhanceSelect(selectEl, cfg) — mavjud <select> ni custom dropdown'ga almashtiradi.
 * <select> yashiriladi, lekin qiymati sinxron (forma yuborilishi, 'change' hodisasi saqlanadi).
 */
export function enhanceSelect(select, cfg = {}) {
  const options = [];
  for (const opt of select.options) {
    if (opt.value === '' && !cfg.keepEmpty) continue;
    options.push({
      value: opt.value, label: opt.textContent.trim(), disabled: opt.disabled,
      group: opt.parentElement.tagName === 'OPTGROUP' ? opt.parentElement.label : undefined,
    });
  }
  const host = document.createElement('div');
  host.className = 'dd-host';
  select.after(host);
  select.hidden = true;
  const label = cfg.label ?? (select.labels?.[0]?.textContent.trim() || '');
  if (select.labels?.[0]) select.labels[0].hidden = true;
  const multi = select.multiple;
  return dropdown(host, {
    options, multi, label,
    value: multi ? [...select.selectedOptions].map((x) => x.value) : (select.value || null),
    search: options.length > 8,
    ...cfg,
    onChange(v) {
      if (multi) for (const opt of select.options) opt.selected = v.includes(opt.value);
      else select.value = v;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      cfg.onChange?.(v);
    },
  });
}
