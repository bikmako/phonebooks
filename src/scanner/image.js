export function imageCanvas(source, width, height) {
  if (!width || !height) throw new Error('Кадр ещё не готов. Дождитесь изображения с камеры.');
  // Bound working memory on mobile devices; preserve enough detail for printed digits.
  const scale = Math.min(1, 2400 / Math.max(width, height), Math.sqrt(3600000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Браузер не поддерживает обработку изображений. Введите IMEI вручную.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function fileCanvas(file) {
  if (!file || file.size > 20 * 1024 * 1024) throw new Error('Выберите изображение размером до 20 МБ.');
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('Выберите фото или снимок экрана в формате JPEG, PNG или WebP.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return imageCanvas(image, image.naturalWidth, image.naturalHeight);
  } catch {
    throw new Error('Не удалось открыть фото. Сохраните его как JPEG или PNG и попробуйте снова.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function rotateCanvas(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.height;
  canvas.height = source.width;
  const context = canvas.getContext('2d');
  context.translate(canvas.width, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(source, 0, 0);
  return canvas;
}
