import type { Metadata } from 'next';
import { AuthGate, PrintButton } from './client';
import './yoriqnoma.css';

export const metadata: Metadata = { title: 'Yo‘riqnoma · Sun HighTech' };

export default function Page() {
  return (
    <>
      <AuthGate />
      <div className="guide">
        <div className="topnav"><a className="btn sm" href="/">← Panelga qaytish</a><a className="btn sm ghost" href="#sotuvchi">Sotuvchi uchun</a><a className="btn sm ghost" href="#filial">Filial rahbari</a><a className="btn sm ghost" href="#rahbar">Rahbar uchun</a><a className="btn sm ghost" href="#qoidalar">Qoidalar</a><PrintButton /></div>
        <div>
          <span className="lbl">Sun HighTech sotuv markazi</span>
          <h1>Yo‘riqnoma</h1>
          <p>Tizim Telegram va Instagram’dagi mijoz yozishmalarini bitta joyga yig‘adi, sotuvchi kechiksa AI javob beradi, bilim bazasidan mahsulot ma’lumotini beradi. Bu sahifa — kundalik ish uchun qisqa qo‘llanma.</p>
        </div>


        <h2 id="sotuvchi">Sotuvchi uchun</h2>

        <div className="panel"><h3>1. Birinchi kirish</h3><ol>
          <li>Rahbar bergan login va bir martalik parol bilan kiring. Chap pastdagi <b>«Parol»</b> tugmasi bilan o‘z parolingizni qo‘ying (joriy parol so‘raladi).</li>
          <li>Chap pastdagi <b>«Telegram ulash»</b> tugmasini bosing, chiqqan havolani Telegram’da oching va <b>Start</b> bosing. Shundan keyin AI javoblari, katta buyurtmalar va eslatmalar Telegram’ga keladi.</li>
        </ol></div>

        <div className="panel"><h3>2. Suhbatlar ro‘yxati</h3>
          <p>Yuqorida javob kutayotganlar va katta buyurtmalar turadi. Belgilar ma’nosi:</p>
          <div className="tbl"><table><tbody>
            <tr><td><span className="pill ai">AI · 1:24</span></td><td>AI javobi tayyor. Shu vaqt ichida siz javob bermasangiz, AI yuboradi.</td></tr>
            <tr><td><span className="pill ai">AI yozmoqda</span></td><td>AI qoralama tayyorlayapti.</td></tr>
            <tr><td><span className="pill warn">Kutmoqda 4 daq</span></td><td>Mijoz javob kutyapti.</td></tr>
            <tr><td><span className="pill bad">Javobsiz 12 daq</span></td><td>Kutish chegarasidan oshdi — rahbarga ko‘rinadi. Birinchi navbatda javob bering.</td></tr>
            <tr><td><span className="pill acc">Katta buyurtma</span></td><td>Uzun ro‘yxat yoki ko‘p dona. Telegram’da «Qabul qilaman» ni 3 daqiqada bosing.</td></tr>
            <tr><td><span className="pill acc">Eslatma 29.09</span></td><td>Mijoz aytgan sanada qayta aloqa.</td></tr>
          </tbody></table></div>
        </div>

        <div className="panel"><h3>3. Javob berish</h3><ul>
          <li>Pastdagi maydonga yozing, <span className="kbd">Enter</span> — yuborish, <span className="kbd">Shift+Enter</span> — yangi qator. Xabar mijozga Sun HighTech akkauntidan boradi.</li>
          <li><b>Yoza boshlaganingizda AI kutadi.</b> Siz yuborsangiz, AI qoralamasi bekor bo‘ladi — bitta savolga ikki javob ketmaydi.</li>
          <li>Telegram ilovasidan to‘g‘ridan-to‘g‘ri javob bersangiz ham tizim buni ko‘radi va AI yozmaydi. Instagram Direct ham xuddi shunday: Instagram ilovasida javob yozsangiz, AI o‘sha suhbatga yozmaydi.</li>
          <li>Instagram suhbatlari shu navbatda, «Instagram» belgisi bilan turadi. Instagram qoidasi bo‘yicha mijoz oxirgi xabaridan keyin 24 soat ichida javob berish mumkin; muddat o‘tsa panel ogohlantiradi va javobni mijoz qayta yozguncha yuborib bo‘lmaydi.</li>
          <li><b>«O‘zim olaman»</b> — suhbatni to‘liq o‘zingizga olasiz, AI bu suhbatda yozmaydi. <b>«AI’ga qaytarish»</b> — yana yordam beradi.</li>
        </ul></div>

        <div className="panel"><h3>4. AI qoralamasi</h3><ul>
          <li><b>Hozir yuborish</b> — qoralama to‘g‘ri bo‘lsa, kutmasdan yuboring.</li>
          <li><b>Tahrirlab o‘zim yuboraman</b> — matn yozish maydoniga ko‘chadi, tuzatib yuborasiz.</li>
          <li><b>Bekor qilish</b> — AI bu savolga javob bermaydi.</li>
          <li><b>Yaxshi / Yomon</b> — baho bering. Bu AI’ni Sun HighTech uslubiga moslash uchun kerak.</li>
          <li>Qoralama ostida manbalar turadi: narx va qoldiq BILLZ’dan, moslik bilim bazasidan. Manba yo‘q bo‘lsa, AI raqam aytmaydi.</li>
          <li><b>«AI javobi yuborilgan bo‘lishi mumkin — Telegram’da tekshiring»</b> — internet uzilib, javob ketgan-ketmagani noma’lum. Telegram’da chatni oching: javob bo‘lsa — qayta yozmang (tizim o‘zi tasdiqlaydi), bo‘lmasa — o‘zingiz javob bering.</li>
          <li>Telegram Business’ning «Uzoqdaman» / «Salomlashuv» xabari sotuvchi javobi hisoblanmaydi — mijoz javob kutishda qoladi, AI yoki siz javob berasiz.</li>
        </ul></div>

        <div className="panel"><h3>5. Mijoz kartasi (o‘ngda)</h3><ul>
          <li><b>BILLZ bilan bog‘lanmagan</b> — xaridlar va keshbek ko‘rsatilmaydi. Mijoz Telegram’da o‘z kontaktini ulashsa, tizim telefon orqali tasdiqlaydi.</li>
          <li><b>Qiziqish darajasi</b> — sovuq / iliq / issiq. AI belgilaydi, siz tuzatasiz — sizning belgingizni AI o‘zgartirmaydi.</li>
          <li><b>Bosqich</b> — bosib o‘zgartiring. «Xarid tasdiqlandi» faqat chek yoki sizning tasdig‘ingiz bilan.</li>
          <li><b>Yo‘qotildi</b> — sabab faqat dalil bilan (mijozning so‘zi, sana). Jim qolish — «raqobatchiga ketdi» degani emas.</li>
          <li><b>Suhbat kartasi → tahrirlash</b> — so‘ralgan tovar, budjet, maqsad, keyingi qadam. Hamkasbingiz mijozdan qayta so‘ramasligi uchun.</li>
          <li>Jim qolgan mijoz: avval AI (kanal oynasi ichida) qisqa eslatma yozadi, keyin suhbat sizga Telegram orqali topshiriladi.</li>
        </ul></div>

        <div className="panel"><h3>6. Katalogdan savol so‘rash</h3><ul>
          <li><b>Bilim bazasi → «Sotuvchi savoli»</b> — mijoz oldida turib so‘rashingiz mumkin: «Bu panelning quvvati qancha?», «Qaysi invertor mos?». Javob faqat sizga ko‘rinadi, mijozga yuborilmaydi.</li>
          <li>Javob ostida manba turadi — qaysi karta va qaysi qoldiqdan olingani. Manba bo‘lmasa, agent «bilmayman» deydi: o‘ylab topmaydi.</li>
          <li><b>«Do‘konda bor»</b> filtri — mijozga bugun berib yuborish mumkin bo‘lgan tovarlar; <b>«Faqat omborda»</b> — olib kelish kerak.</li>
        </ul></div>


        <h2 id="filial">Filial rahbari uchun</h2>

        <div className="panel"><h3>Nima ko‘rinadi</h3><ul>
          <li>Sotuvchida bor narsaning hammasi, ustiga <b>butun filial</b>: filialdagi barcha suhbatlar.</li>
          <li><b>Bilim bazasi</b> — kartani tahrirlash va tasdiqlash sizda bor.</li>
          <li>Suhbatga mas’ul sotuvchi tayinlash — sizda; xodim qo‘shish, AI agent sozlamalari va audit jurnali — sotuv rahbarida.</li>
        </ul></div>


        <h2 id="rahbar">Rahbar uchun</h2>

        <div className="panel"><h3>1. Birinchi sozlash</h3><ol>
          <li><b>Xodimlar va filiallar</b> → filiallar BILLZ ulangach magazinlar ro‘yxatidan o‘zi qo‘shiladi (qo‘lda ham qo‘shsa bo‘ladi). Keyin xodimlarni qo‘shing: ism, login, rol, filial, zaxira mas’ul. Har bir xodimga bir martalik parol chiqadi — o‘ziga bering.</li>
          <li><b>Smena</b> — har xodimga ish kunlari va soatlari. Shoshilinch signallar avval smenadagi sotuvchiga boradi; dam olayotgan xodimga tushmaydi.</li>
          <li>Har bir xodim o‘zi «Telegram ulash» qiladi (yoki jadvaldagi «Havola olish»).</li>
          <li><b>AI agent → Akkauntlar</b> — Telegram Business ulangan akkauntga filial va mas’ul biriktiring.</li>
        </ol></div>

        <div className="panel"><h3>2. AI’ni bosqichma-bosqich yoqish</h3>
          <p>Har bir akkaunt uchun ikki sozlama bor: <b>rejim</b> (qachon javob berish) va <b>bosqich</b> (qanchalik mustaqil).</p>
          <div className="tbl"><table><tbody>
            <tr><td><b>Kuzatish</b></td><td>AI faqat qoralama yozadi, mijozga hech narsa ketmaydi. Sotuvchilar baho beradi. Yangi akkaunt shu bosqichda boshlanadi.</td></tr>
            <tr><td><b>Tasdiq bilan</b></td><td>AI javobi sotuvchi «Hozir yuborish» ni bossagina ketadi.</td></tr>
            <tr><td><b>Avtomatik</b></td><td>Rejimga ko‘ra o‘zi yuboradi: <b>Doim</b> — darhol; <b>Kechiksa</b> — sotuvchi T soniyada javob bermasa; <b>O‘chiq</b> — hech qachon.</td></tr>
          </tbody></table></div>
          <p>Tavsiya: 2–3 kun kuzatish → tasdiq bilan → bitta filialda «Avtomatik + Kechiksa» → qolgan filiallar. Suhbat darajasidagi sozlama akkauntdan ustun turadi.</p>
        </div>

        <div className="panel"><h3>3. Bilim bazasi</h3><ul>
          <li>Qoldiq alohida ko‘rinadi: <b>do‘konda</b> (mijoz shu kuni oladi) va <b>omborda</b>. Filtr: «Do‘konda bor», «Faqat omborda», «Qoldiq yo‘q» va filial bo‘yicha. Filial turi (do‘kon/ombor) — «Xodimlar va filiallar»da.</li>
          <li>AI moslik va xususiyatni faqat <b>tasdiqlangan</b> kartadan aytadi. Tasdiqlanmagan bo‘lsa — savolni sotuvchiga uzatadi.</li>
          <li>Kartani oching → <b>«Katalog agenti bilan to‘ldirish»</b> → ishlab chiqaruvchi manbasidan qoralama → tekshiring → Saqlash → <b>Tasdiqlash</b>.</li>
          <li>Mazmun o‘zgarsa, tasdiq avtomatik olib tashlanadi.</li>
        </ul></div>

        <div className="panel"><h3>4. Kalitlar va xavfsizlik</h3><ul>
          <li>Bot tokeni, AI va BILLZ kalitlari <b>chat, Telegram yoki email orqali yuborilmaydi</b> — faqat serverda maxsus skript orqali kiritiladi.</li>
          <li>Kalit ochilib qolsa: manbada (BotFather / Google AI Studio / Anthropic / BILLZ) bekor qiling va yangisini kiriting.</li>
          <li>Ishdan ketgan xodimni <b>Xodimlar</b> da «o‘chirilgan» qiling — kirishi darhol yopiladi. Uning ochiq seanslari ham tugaydi.</li>
          <li><b>Zaxira nusxa</b> — har kecha olinadi, oxirgi 14 kuni saqlanadi; 36 soat kechiksa Telegram’ga ogohlantirish keladi.</li>
          <li>Har bir avtomatik amal <b>Audit jurnali</b>da ko‘rinadi.</li>
        </ul></div>


        <h2 id="qoidalar">AI qoidalari (mijozlar uchun ham)</h2>
        <div className="panel"><ul>
          <li>Narx, qoldiq va keshbek — faqat BILLZ’dan. Ma’lumot bo‘lmasa yoki eskirgan bo‘lsa, raqam aytilmaydi.</li>
          <li>Chegirma, ulgurji narx, band qilish, yetkazish muddati va kafolat shartlarini AI va’da qilmaydi — bularni sotuvchi hal qiladi.</li>
          <li>AI tabiiy yozadi, lekin o‘zini ismli sotuvchi deb tanishtirmaydi. Mijoz «botmisiz?» deb so‘rasa — avtomatik yordamchi ekanini aytadi va sotuvchiga ulaydi.</li>
          <li>Telegram botga faqat oxirgi 24 soatda yozgan mijozga javob berishga ruxsat beradi. Oyna yopiq bo‘lsa, AI yozmaydi — sotuvchiga topshiriladi.</li>
          <li>Reklama xabari faqat botga ulangan va rozilik bergan mijozga; mijoz <span className="kbd">/stop</span> bilan to‘xtatadi.</li>
        </ul></div>
      </div>

    </>
  );
}
