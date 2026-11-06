import { fileURLToPath } from 'node:url';

const BACKEND = (process.env.BACKEND_URL || 'http://127.0.0.1:8200').replace(/\/+$/, '');
const dev = process.env.NODE_ENV !== 'production';
// HTTPS orqali ishlaganda (src/config.js dagi SECURE bayrog‘i bilan bir xil) HSTS yoqiladi
const secure = /^(1|true|yes|on)$/i.test(process.env.SECURE || '');

/* Eski src/core/http.js dagi CSP bilan bir xil, faqat script-src farqli:
   Next.js App Router sahifani oqim bilan yuboradi va gidratsiya ma’lumotini sahifa ichidagi <script> bloklariga yozadi
   (self.__next_f.push(...)). Nonce har so‘rovda yangi bo‘lishi kerak — bu middleware/proxy va butunlay dinamik renderni talab qiladi
   (statik sahifalar yo‘qoladi), next.config headers esa nonce bera olmaydi. Shuning uchun script-src’da minimal 'unsafe-inline' qoldirildi;
   boshqa hamma manba (begona domen, eval, data:) yopiq. Dev rejimida HMR uchun qo‘shimcha 'unsafe-eval' va ws: kerak. */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `font-src ${dev ? "'self' " : ''}https://fonts.gstatic.com`,
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
  reactStrictMode: true,
  // Proksi qilingan javoblarni (audio Range, CSV) Next siqmasin — siqishni nginx qiladi
  compress: false,
  experimental: {
    // «Internetdan topish», «Katalog agenti bilan to‘ldirish» va AI kalitini tekshirish 30–120 soniya olishi mumkin
    proxyTimeout: 180_000
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/webhook/:path*', destination: `${BACKEND}/webhook/:path*` },
      // Eski nomlar
      { source: '/privacy', destination: '/maxfiylik' },
      { source: '/data-deletion', destination: '/malumot-ochirish' }
    ];
  },
  async headers() {
    const sec = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      ...(secure ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : [])
    ];
    return [
      // /api va /webhook javoblari Go backenddan o‘zining sarlavhalari bilan keladi
      { source: '/((?!api/|webhook/|_next/static/).*)', headers: [...sec, { key: 'Content-Security-Policy', value: CSP }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }
    ];
  }
};

export default nextConfig;
