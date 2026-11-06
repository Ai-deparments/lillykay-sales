/**
 * SUN-HIGHTECH — «AI lid» jadvaliga izohdan kelgan lidni yozish
 *
 * Bu kod jadvalning O'ZIGA qo'yiladi. Sotuv tizimi (sales-api) shu manzilga
 * POST yuboradi, kod qatorni qo'shadi. Xizmat hisobi va kalit fayli kerak emas.
 *
 * Ustunlar SARLAVHA BO'YICHA topiladi — jadvalda ustun joyi o'zgarsa ham ishlaydi,
 * Meta target yozadigan __row_id__ va __synced__ ustunlariga tegilmaydi.
 *
 * MUHIM: jadvalning O'ZIDAGI Apps Script'ga TEGMANG — u yerda «Odoo Sync» kodi bor,
 * ustidan yozilsa o'sha ishlamay qoladi. Shuning uchun bu kod ALOHIDA loyihada turadi
 * va jadvalni ID orqali ochadi.
 *
 * === O'RNATISH (2 daqiqa) ===
 * 1. script.google.com → New project (jadval ichidan EMAS)
 * 2. Bor namunani o'chirib, shuni joylashtiring → saqlang
 * 3. Deploy → New deployment → turi: Web app
 *      Execute as: Me       Who has access: Anyone
 * 4. Birinchi deployda Google ruxsat so'raydi — jadvalni o'zgartirishga ruxsat bering
 * 5. Chiqqan «.../exec» havolasini oling — sozlamaga shu qo'yiladi
 */

// Sotuv tizimidagi SHEET_SECRET bilan bir xil bo'lishi shart.
var MAXFIY_SOZ = 'ffvl000y-ylw4ejj8-adg7a46v';

// Qaysi jadval va qaysi varaq (Meta lidlari ham shu yerda).
var JADVAL_ID = '1P_KrXdRXoPpGOT8PoZWNpreUwYJlYCzXFYlCdaB1T-8';
var VARAQ = 'Reklama';

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.maxfiy !== MAXFIY_SOZ) return javob({ ok: false, xato: 'maxfiy soz notogri' });

    var varaq = SpreadsheetApp.openById(JADVAL_ID).getSheetByName(VARAQ);
    if (!varaq) return javob({ ok: false, xato: 'varaq topilmadi: ' + VARAQ });

    var sarlavha = varaq.getRange(1, 1, 1, varaq.getLastColumn()).getValues()[0];
    var qiymat = {
      'Name': d.ism || '',
      'Opportunity': d.sorov || '',
      'Phone': d.telefon ? "'" + d.telefon : '',   // apostrof: raqam matn bolib qolsin
      'Sana': d.sana || new Date(),
      'Hudud': d.hudud || '',
      'Forma': d.forma || 'Instagram izoh',
      'Lid ID': d.lid_id || '',
      'Kanal': d.kanal || ''
    };

    var qator = sarlavha.map(function (nom) {
      return Object.prototype.hasOwnProperty.call(qiymat, nom) ? qiymat[nom] : '';
    });
    varaq.appendRow(qator);
    return javob({ ok: true, qator: varaq.getLastRow() });
  } catch (err) {
    return javob({ ok: false, xato: String(err) });
  }
}

function doGet() {
  return javob({ ok: true, holat: 'ishlayapti', varaq: VARAQ });
}

function javob(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
