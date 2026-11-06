/* Kompaniya brendi — nom o‘zgarsa, faqat shu yerda o‘zgartiriladi */
export const BRAND = { name: 'Sun HighTech', sub: 'Sotuv markazi', tag: 'Quyosh panellari · Sotuv markazi', short: 'Sun HighTech' };

/* Logo: quyosh + quyosh paneli. 64×64 kvadrat, o‘z fonli (zarg‘aldoq gradient). */
export const LOGO_SVG = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>
<linearGradient id="shg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc83d"/><stop offset=".55" stop-color="#ff9a1f"/><stop offset="1" stop-color="#ef5a0c"/></linearGradient>
<linearGradient id="shp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f3b73"/><stop offset="1" stop-color="#0c1d45"/></linearGradient></defs>
<rect width="64" height="64" rx="16" fill="url(#shg)"/>
<g stroke="#fff6dc" stroke-width="2.6" stroke-linecap="round"><path d="M32 6v5M13.5 13.5l3.5 3.5M50.5 13.5L47 17M7 28h5M52 28h5"/></g>
<circle cx="32" cy="26" r="9" fill="#fff6dc"/>
<path d="M6 54 14 36H50l8 18z" fill="url(#shp)"/>
<g stroke="#8fb4ff" stroke-width="1.3" opacity=".9" stroke-linecap="round"><path d="M10 45.5H54M7.7 50.5H56.3M26 36 22 54M38 36l4 18M32 36v18"/></g></svg>`;
