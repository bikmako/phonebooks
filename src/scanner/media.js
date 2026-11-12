export const stopStream = stream => stream?.getTracks().forEach(track => track.stop());

export async function openCamera(mediaDevices = navigator.mediaDevices) {
  let lastError;
  for (const video of [
    { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    { facingMode: { ideal: 'environment' } },
    true,
  ]) {
    try { return await mediaDevices.getUserMedia({ audio: false, video }); }
    catch (error) {
      lastError = error;
      if (!['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(error.name)) throw error;
    }
  }
  throw lastError;
}

export function cameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError': case 'PermissionDeniedError':
      return 'Доступ к камере запрещён. Разрешите его в настройках браузера.';
    case 'NotFoundError': case 'DevicesNotFoundError':
      return 'Камера не найдена. Выберите фото.';
    case 'NotReadableError': case 'TrackStartError':
      return 'Камера занята. Закройте другое приложение и повторите.';
    default:
      return 'Не удалось включить камеру. Повторите или выберите фото.';
  }
}
