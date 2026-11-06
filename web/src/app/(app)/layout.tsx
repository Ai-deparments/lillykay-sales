import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../app.css';
import '../glass.css';
import '../dropdown.css';
import '../agentflow.css';

export const metadata: Metadata = {
  title: 'Sun HighTech · Sotuv markazi',
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Sun HighTech' },
  other: { 'apple-mobile-web-app-capable': 'yes' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#FFFFFF' }, { media: '(prefers-color-scheme: dark)', color: '#151B1A' }]
};

/* «Ilovani yuklab olish» (PWA) mantiqi — public/pwa.js. Defersiz: viewport hiylasi sahifa chizilishidan oldin ishlashi kerak.
   Shriftlar — eski sahifalardagidek Google Fonts (CSP: style-src/font-src shu domenlarga ruxsat beradi). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&family=Unbounded:wght@500;600&display=swap" precedence="default" />
      <script src="/pwa.js" />
      {children}
    </>
  );
}
