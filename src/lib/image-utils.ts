/**
 * Утилита для оптимизации изображений на стороне клиента.
 * Помогает избежать ошибок Firestore (лимит 1МБ) и Firebase Auth (лимит длины URL).
 */
export async function resizeImage(base64Str: string, maxWidth = 800, maxHeight = 800): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Рассчитываем новые размеры, сохраняя пропорции
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round(width * (maxHeight / height));
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Рисуем изображение на канвасе с новыми размерами
        ctx.drawImage(img, 0, 0, width, height);
        // Конвертируем в JPEG с качеством 0.8 (оптимально для веса и качества)
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } else {
        resolve(base64Str);
      }
    };
    img.onerror = () => resolve(base64Str);
  });
}
