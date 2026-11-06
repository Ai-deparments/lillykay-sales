/* output: 'standalone' faqat server.js va kerakli node_modules’ni yig‘adi — statik fayllar va public/ ni qo‘lda ko‘chirish kerak
   (Next.js hujjati). `npm run build` shu skriptni o‘zi chaqiradi, shunda `.next/standalone` darhol ishga tushadi. */
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const out = '.next/standalone';
if (!existsSync(out)) { console.error('postbuild: .next/standalone yo‘q (output: standalone yoqilganmi?)'); process.exit(1); }
mkdirSync(`${out}/.next`, { recursive: true });
cpSync('.next/static', `${out}/.next/static`, { recursive: true });
if (existsSync('public')) cpSync('public', `${out}/public`, { recursive: true });
console.log('postbuild: .next/static va public/ -> .next/standalone');
