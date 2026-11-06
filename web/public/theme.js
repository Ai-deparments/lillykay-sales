/* Mavzu: yorug' / qorong'i / tizim bo'yicha. CSP sabab sahifa ichida skript yozilmaydi — shuning uchun alohida fayl.
   Bu fayl <head> da, defersiz yuklanadi: sahifa chizilgunga qadar mavzu qo'yiladi, shuning uchun oq lip etish bo'lmaydi.
   «Tizim bo'yicha» — kompyuter qorong'i bo'lsa, panel ham qorong'i (dizayn faqat data-theme bilan ishlaydi). */
(function () {
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function apply() {
    var t;
    try { t = localStorage.getItem('pb_theme'); } catch (e) { t = null; }
    document.documentElement.dataset.theme = (t === 'light' || t === 'dark') ? t : (mq && mq.matches ? 'dark' : 'light');
  }
  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
})();
