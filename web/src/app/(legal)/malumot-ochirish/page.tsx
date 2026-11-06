import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Photobuy — Ma’lumotlarni o‘chirish / Data Deletion' };

export default function Page() {
  return (
    <main className="md">
      <h1>Ma’lumotlarni o‘chirish</h1>
      <div className="muted">Data Deletion Instructions · Удаление данных · <a href="/maxfiylik">Maxfiylik siyosati / Privacy Policy</a></div>
    
      <section>
        <h2>O‘zbekcha</h2>
        <ol>
          <li>Photobuy’ning Instagram yoki Telegram akkauntiga yozing: «Ma’lumotlarimni o‘chiring».</li>
          <li>Biz 30 kun ichida siz bilan yozishmalarimizni, ismingizni, foydalanuvchi nomingizni va siz bergan telefon raqamini serverimizdan o‘chiramiz va bu haqda xabar beramiz.</li>
          <li>Qonun bo‘yicha saqlanishi shart bo‘lgan xarid hujjatlari (chek) bundan mustasno.</li>
        </ol>
      </section>
    
      <section>
        <h2>English</h2>
        <ol>
          <li>Send a message to Photobuy’s Instagram or Telegram account saying “Please delete my data”.</li>
          <li>Within 30 days we delete our conversations with you, your name, username and any phone number you shared from our server, and confirm it to you.</li>
          <li>Purchase records (receipts) that we are legally required to keep are excluded.</li>
        </ol>
      </section>
    
      <section>
        <h2>Русский</h2>
        <ol>
          <li>Напишите в аккаунт Photobuy в Instagram или Telegram: «Удалите мои данные».</li>
          <li>В течение 30 дней мы удалим переписку с вами, имя, имя пользователя и номер телефона с нашего сервера и сообщим об этом.</li>
          <li>Документы о покупке (чеки), которые мы обязаны хранить по закону, не удаляются.</li>
        </ol>
      </section>
    </main>
  );
}
