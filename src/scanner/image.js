export function imageCanvas(source, width, height) {
  if (!width || !height) throw new Error('Кадр ещё не готов. Дождитесь изображения с камеры.');
  // Bound working memory on mobile devices; preserve enough detail for printed digits.
  const scale = Math.min(1, 3200 / Math.max(width, height), Math.sqrt(6000000 / (width * height)));
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

export function cropCanvas(source, box, enhance = false) {
  const x = Math.max(0, Math.floor(box.x0));
  const y = Math.max(0, Math.floor(box.y0));
  const width = Math.max(1, Math.min(source.width - x, Math.ceil(box.x1 - x)));
  const height = Math.max(1, Math.min(source.height - y, Math.ceil(box.y1 - y)));
  const scale = Math.min(3, Math.max(1, 64 / height), 3000 / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  if (enhance) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const histogram = new Uint32Array(256);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = Math.round(.299 * pixels.data[i] + .587 * pixels.data[i + 1] + .114 * pixels.data[i + 2]);
      pixels.data[i] = gray; histogram[gray]++;
    }
    const percentile = target => {
      let count = 0;
      for (let i = 0; i < 256; i++) { count += histogram[i]; if (count >= target) return i; }
      return 255;
    };
    const low = percentile(canvas.width * canvas.height * .01);
    const high = percentile(canvas.width * canvas.height * .99);
    const range = Math.max(40, high - low);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = Math.max(0, Math.min(255, (pixels.data[i] - low) * 255 / range));
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
    }
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

export function alignText(source, angle = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width + 48;
  canvas.height = source.height + 24;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

export function crispText(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < image.data.length; i += 4) histogram[image.data[i]]++;
  let count = 0, weight = 0, score = -1, threshold = 127;
  const total = image.data.length / 4;
  const sum = histogram.reduce((value, frequency, level) => value + frequency * level, 0);
  for (let level = 0; level < 255; level++) {
    count += histogram[level];
    weight += histogram[level] * level;
    if (!count || count === total) continue;
    const variance = (weight / count - (sum - weight) / (total - count)) ** 2 * count * (total - count);
    if (variance > score) { score = variance; threshold = level; }
  }
  for (let i = 0; i < image.data.length; i += 4) {
    const value = image.data[i] <= threshold ? 0 : 255;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

export function cameraFrame(video, { textOnly = false } = {}) {
  const full = imageCanvas(video, video.videoWidth, video.videoHeight);
  if (!textOnly) return full;
  return cropCanvas(full, { x0: full.width * .06, y0: full.height * .28, x1: full.width * .94, y1: full.height * .72 });
}
