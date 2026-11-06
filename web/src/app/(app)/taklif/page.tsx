import type { Metadata } from 'next';
import { InviteForm } from './InviteForm';

export const metadata: Metadata = { title: 'Hisobni faollashtirish · Sun HighTech', robots: { index: false, follow: false } };

export default function Page() {
  return <InviteForm />;
}
