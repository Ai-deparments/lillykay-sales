/* Rasm brauzerda kichraytiriladi: telefon rasmi 4–8 MB bo‘ladi, mijozga 1600px yetarli. JPEG base64 (data: prefiksisiz) qaytaradi. */
export function shrinkImage(file: File, max = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Rasmni o‘qib bo‘lmadi')); };
    img.src = url;
  });
}
