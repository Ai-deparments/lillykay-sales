import type { ReactNode } from 'react';

/* Ildiz maket: faqat <html>/<body>. Mavzu skripti <head> da, defersiz — sahifa chizilgunga qadar mavzu qo‘yiladi (miltillash yo‘q).
   data-theme atributini skript gidratsiyadan oldin qo‘yadi, shuning uchun suppressHydrationWarning. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        <script src="/theme.js" />
      </head>
      <body data-role="">
        {children}
      </body>
    </html>
  );
}
