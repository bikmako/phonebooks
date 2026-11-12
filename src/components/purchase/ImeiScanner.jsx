import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ImagePlus, RotateCw, X } from 'lucide-react';
import { Button } from '../ui.jsx';
import { fileCanvas, imageCanvas, rotateCanvas } from '../../scanner/image.js';
import { cameraError, stopStream } from '../../scanner/media.js';
import { isValidImei } from '../../utils/imei.js';
import '../../styles/imei-scanner.css';

const NO_RESULT = 'Надёжный IMEI не найден. Нужны 15 цифр с верной контрольной суммой. Поднесите камеру ближе, уберите блики или выберите более чёткое фото.';

export function ImeiScanner({ onClose, onConfirm }) {
  const dialog = useRef(null);
  const video = useRef(null);
  const preview = useRef(null);
  const stream = useRef(null);
  const engine = useRef(null);
  const generation = useRef(0);
  const cameraRequest = useRef(0);
  const mounted = useRef(false);
  const [camera, setCamera] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [image, setImage] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState('');

  const stopCamera = useCallback(() => {
    cameraRequest.current++;
    stopStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    if (mounted.current) { setCamera(false); setStarting(false); }
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setError('');
    setCandidates([]);
    setSelected('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Камера недоступна в этом браузере. Откройте приложение по HTTPS или выберите фото из галереи.');
      return;
    }
    const request = ++cameraRequest.current;
    setStarting(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (!mounted.current || request !== cameraRequest.current) { stopStream(media); return; }
      stream.current = media;
      video.current.srcObject = media;
      await video.current.play();
      if (mounted.current && request === cameraRequest.current) { setCamera(true); setImage(null); }
    } catch (cause) {
      if (mounted.current && request === cameraRequest.current) { stopCamera(); setError(cameraError(cause)); }
    } finally {
      if (mounted.current && request === cameraRequest.current) setStarting(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement;
    dialog.current.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void startCamera();
    const hideCamera = () => { if (document.hidden) stopCamera(); };
    document.addEventListener('visibilitychange', hideCamera);
    return () => {
      mounted.current = false;
      generation.current++;
      stopCamera();
      engine.current?.dispose();
      engine.current = null;
      dialog.current?.close();
      document.removeEventListener('visibilitychange', hideCamera);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (!image || !preview.current) return;
    preview.current.width = image.width;
    preview.current.height = image.height;
    preview.current.getContext('2d').drawImage(image, 0, 0);
  }, [image]);

  async function recognize(loadImage) {
    const run = ++generation.current;
    const current = () => mounted.current && generation.current === run;
    stopCamera();
    setCandidates([]);
    setSelected('');
    setError('');
    setBusy(true);
    setProgress('Подготавливаем изображение…');
    let timeout;
    try {
      const canvas = await loadImage();
      if (!current()) return;
      setImage(canvas);
      const { createRecognizer } = await import('../../scanner/recognizer.js');
      if (!current()) return;
      engine.current ??= createRecognizer(message => { if (mounted.current) setProgress(message); });
      const result = await Promise.race([
        engine.current.recognize(canvas),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Распознавание заняло слишком много времени. Попробуйте более чёткое фото или введите IMEI вручную.')), 60000); }),
      ]);
      if (!current()) return;
      setCandidates(result.candidates);
      setError(result.warning || (result.candidates.length ? '' : NO_RESULT));
    } catch (cause) {
      if (!current()) return;
      engine.current?.dispose();
      engine.current = null;
      setError(cause.message || 'Ошибка распознавания. Попробуйте другое фото или введите IMEI вручную.');
    } finally {
      clearTimeout(timeout);
      if (current()) { setBusy(false); setProgress(''); }
    }
  }

  function capture() {
    // Snapshot before stopping the camera (Safari can clear a stopped video immediately).
    try {
      const canvas = imageCanvas(video.current, video.current.videoWidth, video.current.videoHeight);
      void recognize(() => canvas);
    } catch (cause) { setError(cause.message); }
  }

  return createPortal(
    <dialog ref={dialog} className="imei-scanner" aria-modal="true" aria-labelledby="imei-scanner-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === dialog.current) onClose(); }}>
      <div className="imei-scanner-panel">
        <header className="imei-scanner-header">
          <div>
            <h2 id="imei-scanner-title">Сканировать IMEI</h2>
            <p>Экран *#06#, коробка или наклейка</p>
          </div>
          <button type="button" className="btn-icon" aria-label="Закрыть сканер" onClick={onClose} autoFocus><X size={20} /></button>
        </header>
        <div className="imei-scanner-body" aria-busy={busy}>
          <p className="imei-scanner-help">Расположите номер или штрихкод целиком в кадре и нажмите «Распознать кадр». Избегайте бликов; цифры должны быть чёткими.</p>
          <div className="imei-scanner-view" hidden={!camera && !starting && !image}>
            <video ref={video} autoPlay muted playsInline hidden={!camera && !starting} aria-label="Предпросмотр камеры" />
            {image && <canvas ref={preview} role="img" aria-label="Изображение для распознавания" />}
          </div>
          <div className="imei-scanner-actions">
            {camera
              ? <Button type="button" icon={<Camera size={18} />} onClick={capture} disabled={busy}>Распознать кадр</Button>
              : <Button type="button" variant="secondary" icon={<Camera size={18} />} onClick={startCamera} disabled={busy || starting}>{starting ? 'Включаем камеру…' : 'Включить камеру'}</Button>}
            <label className="btn-secondary btn-md imei-scanner-upload" aria-disabled={busy}>
              <ImagePlus size={18} /> Из галереи
              <input type="file" accept="image/*" aria-label="Изображение с IMEI" disabled={busy}
                onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void recognize(() => fileCanvas(file)); }} />
            </label>
            {image && <Button type="button" variant="ghost" icon={<RotateCw size={18} />} disabled={busy}
              onClick={() => void recognize(() => rotateCanvas(image))}>Повернуть фото</Button>}
          </div>
          <p className="imei-scanner-status" role="status" aria-live="polite">{progress}</p>
          {error && <p className="imei-scanner-error" role="alert">{error}</p>}
          {candidates.length > 0 && <fieldset className="imei-scanner-results">
            <legend>{candidates.length > 1 ? 'Найдено несколько IMEI. Выберите нужный' : 'Найден IMEI. Выберите его для подтверждения'}</legend>
            {candidates.map(imei => <label key={imei}>
              <input type="radio" name="scanned-imei" value={imei} checked={selected === imei} onChange={() => setSelected(imei)} />
              <span>{imei}</span>
            </label>)}
            <p>Сверьте номер с оригиналом. Проверены 15 цифр и контрольная сумма Luhn.</p>
          </fieldset>}
          <p className="imei-scanner-help">Обработка только на этом устройстве. Фото и IMEI не отправляются на сервер. После загрузки ресурсов сканер работает офлайн.</p>
        </div>
        <footer className="imei-scanner-actions imei-scanner-footer">
          <Button type="button" variant="secondary" onClick={onClose}>Отмена</Button>
          <Button type="button" disabled={busy || !candidates.includes(selected) || !isValidImei(selected)}
            onClick={() => { if (candidates.includes(selected) && isValidImei(selected)) onConfirm(selected); }}>Подтвердить IMEI</Button>
        </footer>
      </div>
    </dialog>, document.body,
  );
}
