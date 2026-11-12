import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ImagePlus, RotateCw, X, ChevronRight } from 'lucide-react';
import { Button } from '../ui.jsx';
import { fileCanvas, cameraFrame, rotateCanvas } from '../../scanner/image.js';
import { cameraError, openCamera, stopStream } from '../../scanner/media.js';
import { isValidImei } from '../../utils/imei.js';
import '../../styles/imei-scanner.css';

export function ImeiScanner({ onClose, onConfirm }) {
  const dialog = useRef(null), video = useRef(null), preview = useRef(null);
  const stream = useRef(null), engine = useRef(null), enginePending = useRef(null);
  const epoch = useRef(0), alive = useRef(false), finished = useRef(false);
  const timer = useRef(null), cancelJob = useRef(null), lastRead = useRef(null);
  const confirm = useRef(onConfirm); confirm.current = onConfirm;
  const [camera, setCamera] = useState(false), [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [error, setError] = useState(''), [image, setImage] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const current = id => alive.current && !finished.current && epoch.current === id;

  const stopCamera = useCallback(() => {
    clearTimeout(timer.current);
    stopStream(stream.current); stream.current = null;
    if (video.current) video.current.srcObject = null;
    if (alive.current) { setCamera(false); setStarting(false); }
  }, []);

  const reset = useCallback(() => {
    epoch.current++;
    stopCamera();
    cancelJob.current?.(); cancelJob.current = null;
    engine.current?.dispose(); engine.current = null; enginePending.current = null;
    lastRead.current = null;
    return epoch.current;
  }, [stopCamera]);

  async function bounded(job) {
    let timeout, cancel;
    const abort = new Promise((_, reject) => {
      cancel = () => reject(new DOMException('Закрыто', 'AbortError'));
      cancelJob.current = cancel;
      timeout = setTimeout(() => reject(new Error('Не удалось распознать. Попробуйте другое фото.')), 45000);
    });
    try { return await Promise.race([job(), abort]); }
    finally { clearTimeout(timeout); if (cancelJob.current === cancel) cancelJob.current = null; }
  }

  async function getEngine(id) {
    if (!enginePending.current) {
      enginePending.current = import('../../scanner/recognizer.js').then(({ createRecognizer }) => {
        if (!current(id)) throw new DOMException('Закрыто', 'AbortError');
        engine.current = createRecognizer(message => { if (current(id)) setStatus(message); });
        return engine.current;
      });
    }
    return enginePending.current;
  }

  function finish(imei) {
    if (finished.current || !alive.current || !isValidImei(imei)) return;
    finished.current = true;
    reset();
    confirm.current(imei);
  }

  function accept(values, { live = false, barcode = false, frame = null } = {}) {
    const valid = [...new Set(values.filter(isValidImei))];
    if (valid.length > 1) {
      stopCamera(); setImage(frame); setCandidates(valid); setStatus('Выберите IMEI');
      return true;
    }
    if (valid.length === 1) {
      const value = valid[0];
      // A barcode already has its symbology checksum plus IMEI Luhn. OCR from
      // video must agree across two distinct captures before automatic filling.
      if (live && !barcode) {
        const previous = lastRead.current;
        lastRead.current = { value, at: Date.now() };
        if (previous?.value !== value || Date.now() - previous.at > 10000) { setStatus('Проверяем номер…'); return false; }
      }
      finish(value); return true;
    }
    return false;
  }

  async function scanLoop(id, frameNumber = 0) {
    if (!current(id) || !stream.current) return;
    if (!video.current?.videoWidth || video.current.readyState < 2) {
      timer.current = setTimeout(() => void scanLoop(id, frameNumber), 150); return;
    }
    try {
      await bounded(async () => {
        const scanner = await getEngine(id);
        if (!current(id)) return;
        const full = cameraFrame(video.current);
        const codes = await scanner.scanBarcodes(full);
        if (!current(id) || accept(codes, { live: true, barcode: true, frame: full })) return;
        const frame = frameNumber % 3 === 2 ? full : cameraFrame(video.current, { textOnly: true });
        const text = await scanner.readText(frame, { live: true });
        if (!current(id) || accept(text, { live: true, frame: full })) return;
        if (!text.length) setStatus('Наведите на IMEI или штрихкод');
      });
    } catch (cause) {
      if (!current(id) || cause.name === 'AbortError') return;
      stopCamera(); setError(cause.message || 'Не удалось запустить сканер. Повторите.'); setStatus(''); return;
    }
    if (current(id) && stream.current) timer.current = setTimeout(() => void scanLoop(id, frameNumber + 1), 250);
  }

  const startCamera = useCallback(async () => {
    const id = reset();
    setError(''); setImage(null); setCandidates([]); setBusy(false); setStatus('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Камера недоступна. Откройте сайт в Safari или выберите фото.'); return;
    }
    setStarting(true);
    try {
      const media = await openCamera();
      if (!current(id)) { stopStream(media); return; }
      stream.current = media;
      video.current.srcObject = media;
      await video.current.play();
      if (!current(id)) return;
      const track = media.getVideoTracks?.()[0];
      if (track?.getCapabilities?.().focusMode?.includes('continuous')) void track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      setCamera(true); setStarting(false); setStatus('Наведите на IMEI или штрихкод');
      void scanLoop(id);
    } catch (cause) {
      if (current(id)) { stopCamera(); setError(cameraError(cause)); }
    }
  }, [reset, stopCamera]);

  useEffect(() => {
    alive.current = true; finished.current = false;
    const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    dialog.current.showModal(); document.body.style.overflow = 'hidden';
    void startCamera();
    const hide = () => { if (document.hidden) { reset(); setBusy(false); setStatus(''); } };
    document.addEventListener('visibilitychange', hide);
    return () => {
      alive.current = false; finished.current = true; reset();
      dialog.current?.close(); document.removeEventListener('visibilitychange', hide);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [reset, startCamera]);

  useEffect(() => {
    if (!image || !preview.current) return;
    preview.current.width = image.width; preview.current.height = image.height;
    preview.current.getContext('2d').drawImage(image, 0, 0);
  }, [image]);

  async function readImage(load) {
    const id = reset();
    setBusy(true); setError(''); setCandidates([]); setImage(null); setStatus('Ищем IMEI…');
    try {
      await bounded(async () => {
        const canvas = await load();
        if (!current(id)) return;
        setImage(canvas);
        const scanner = await getEngine(id);
        const result = await scanner.recognize(canvas);
        if (!current(id) || accept(result.candidates, { frame: canvas })) return;
        setError(result.warning || 'IMEI не найден. Попробуйте ближе или без бликов.'); setStatus('');
      });
    } catch (cause) {
      if (current(id) && cause.name !== 'AbortError') { setError(cause.message || 'Не удалось прочитать фото.'); setStatus(''); }
    } finally { if (current(id)) setBusy(false); }
  }

  return createPortal(
    <dialog ref={dialog} className="imei-scanner" aria-modal="true" aria-labelledby="imei-scanner-title"
      onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) onClose(); }}>
      <div className="imei-scanner-panel">
        <header className="imei-scanner-header">
          <h2 id="imei-scanner-title">Сканировать IMEI</h2>
          <button type="button" className="btn-icon" aria-label="Закрыть сканер" onClick={onClose} autoFocus><X size={20} /></button>
        </header>
        <div className="imei-scanner-body" aria-busy={busy}>
          <div className="imei-scanner-view" hidden={!camera && !starting && !image}>
            <video ref={video} autoPlay muted playsInline hidden={!camera && !starting} aria-label="Предпросмотр камеры" />
            {(camera || starting) && <div className="imei-scanner-guide" aria-hidden="true" />}
            {image && <canvas ref={preview} role="img" aria-label="Изображение для распознавания" />}
          </div>
          {status && <p className="imei-scanner-status" role="status" aria-live="polite">{status}</p>}
          {error && <p className="imei-scanner-error" role="alert">{error}</p>}
          {candidates.length > 1 && <div className="imei-scanner-results" role="group" aria-label="Выберите IMEI">
            {candidates.map(imei => <button type="button" key={imei} onClick={() => finish(imei)} aria-label={`Выбрать IMEI ${imei}`}>
              <span>{imei}</span><ChevronRight size={18} />
            </button>)}
          </div>}
          <div className="imei-scanner-actions">
            {!camera && <Button type="button" variant="secondary" icon={<Camera size={18} />} onClick={startCamera} disabled={busy || starting}>{starting ? 'Включаем…' : 'Камера'}</Button>}
            <label className="btn-secondary btn-md imei-scanner-upload" aria-disabled={busy}>
              <ImagePlus size={18} /> Из галереи
              <input type="file" accept="image/*" aria-label="Изображение с IMEI" disabled={busy}
                onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readImage(() => fileCanvas(file)); }} />
            </label>
            {image && <Button type="button" variant="ghost" icon={<RotateCw size={18} />} disabled={busy}
              onClick={() => void readImage(() => rotateCanvas(image))}>Повернуть</Button>}
          </div>
        </div>
      </div>
    </dialog>, document.body,
  );
}
