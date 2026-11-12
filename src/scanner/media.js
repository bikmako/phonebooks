export const stopStream = stream => stream?.getTracks().forEach(track => track.stop());

export function cameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError': case 'PermissionDeniedError':
      return 'Доступ к камере запрещён. Разрешите его в настройках браузера или выберите фото из галереи.';
    case 'NotFoundError': case 'DevicesNotFoundError':
      return 'Камера не найдена. Выберите фото из галереи или введите IMEI вручную.';
    case 'NotReadableError': case 'TrackStartError':
      return 'Камера занята другим приложением. Освободите её и попробуйте снова или выберите фото.';
    default:
      return 'Не удалось включить камеру. Попробуйте снова или выберите фото из галереи.';
  }
}
