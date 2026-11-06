import type { Viewport } from 'next';
import './legal.css';

/* Ochiq sahifalar (Meta ilovasi talabi): maxfiylik siyosati va ma’lumotlarni o‘chirish — kirishsiz, app.css’siz */
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
