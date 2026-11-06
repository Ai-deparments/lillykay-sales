/* Mavzu: yorug' / qorong'i / tizim bo'yicha. CSP sabab sahifa ichida skript yozilmaydi — shuning uchun alohida fayl.
   Bu fayl <head> da, defersiz yuklanadi: sahifa chizilgunga qadar mavzu qo'yiladi, shuning uchun oq lip etish bo'lmaydi. */
(function () {
  var t;
  try { t = localStorage.getItem('pb_theme'); } catch (e) { t = null; }
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;      // 'auto' — tizim sozlamasi
})();
