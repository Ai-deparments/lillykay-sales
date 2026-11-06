import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Kirish · Sun HighTech' };

export default function Page() {
  return <LoginForm />;
}
