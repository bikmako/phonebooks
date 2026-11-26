import React, { useEffect, useRef } from 'react';

let turnstileScript;
function loadTurnstile() {
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Проверка недоступна.'));
    script.onerror = () => {
      script.remove();
      reject(new Error('Проверка недоступна.'));
    };
    document.head.append(script);
  }).catch(error => {
    turnstileScript = undefined;
    throw error;
  });
  return turnstileScript;
}

function Challenge({ siteKey, onToken }) {
  const container = useRef(null);
  const [error, setError] = React.useState('');
  useEffect(() => {
    let cancelled = false;
    let widget;
    let api;
    loadTurnstile().then(turnstile => {
      if (cancelled) return;
      api = turnstile;
      widget = api.render(container.current, {
        sitekey: siteKey,
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    }).catch(error => { if (!cancelled) setError(error.message); });
    return () => {
      cancelled = true;
      if (widget !== undefined) api.remove(widget);
    };
  }, [siteKey, onToken]);
  return <><div ref={container} />{error && <p role="alert">{error} Обновите страницу.</p>}</>;
}

const labels = {
  login: 'Вход',
  register: 'Регистрация',
  recover: 'Восстановление пароля',
  resend: 'Повторная отправка письма',
  password: 'Новый пароль',
  confirm: 'Подтверждение почты',
  reset: 'Восстановление пароля',
};
const actions = {
  login: 'Войти',
  register: 'Создать аккаунт',
  recover: 'Отправить ссылку',
  resend: 'Отправить письмо',
  password: 'Сохранить пароль',
  confirm: 'Подтвердить адрес',
  reset: 'Продолжить восстановление',
};

const secondaryLinks = {
  login: [['recover', 'Забыли пароль?'], ['register', 'Создать аккаунт'], ['resend', 'Отправить письмо подтверждения повторно']],
  register: [['login', 'Ко входу']],
  recover: [['login', 'Ко входу']],
  resend: [['login', 'Ко входу']],
  password: [['login', 'Ко входу']],
  confirm: [['login', 'Ко входу'], ['resend', 'Отправить письмо подтверждения повторно']],
  reset: [['login', 'Ко входу'], ['recover', 'Запросить новую ссылку']],
};

export function AuthLayout({ soloUrl, children }) {
  return <main className="pb-auth">
    <div className="pb-auth-content">
      <p className="pb-auth-logo">PhoneBooks<span aria-hidden="true" /></p>
      {children}
      {soloUrl && <a className="pb-auth-solo" href={soloUrl} rel="noreferrer">Перейти в Solo</a>}
    </div>
  </main>;
}

export function AccountForm({ view, siteKey, busy, note, error, onSubmit, onView }) {
  const [captcha, setCaptcha] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const callback = view === 'confirm' || view === 'reset';
  const needsEmail = !callback && view !== 'password';
  const needsPassword = ['register', 'login', 'password'].includes(view);
  const verify = needsEmail && Boolean(siteKey);
  return (
    <section className="pb-auth-view" aria-labelledby="pb-auth-title">
      <h1 id="pb-auth-title">{labels[view]}</h1>
      {note && <p className="pb-auth-feedback" role="status">{note}</p>}
      {error && <p className="pb-auth-feedback pb-auth-error" role="alert">{error}</p>}
      <form aria-busy={busy} onSubmit={async event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        await onSubmit(view, verify ? { ...values, captcha } : values);
        if (verify) {
          setCaptcha('');
          setAttempt(value => value + 1);
        }
      }}>
        {needsEmail && <label>Электронная почта<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>}
        {needsPassword && <label>{view === 'password' ? 'Новый пароль' : 'Пароль'}
          <input name="password" type="password" autoComplete={view === 'login' ? 'current-password' : 'new-password'}
            minLength={view === 'login' ? 1 : 12} maxLength={72} required />
        </label>}
        {verify && <Challenge key={attempt} siteKey={siteKey} onToken={setCaptcha} />}
        <button className="pb-auth-primary" disabled={busy || (verify && !captcha)}>
          {busy && <span className="pb-auth-spinner" aria-hidden="true" />}
          {actions[view]}
        </button>
      </form>
      {busy && <p className="pb-auth-progress" role="status">Обрабатываем запрос…</p>}
      <nav className="pb-auth-links" aria-label="Действия с аккаунтом">
        {secondaryLinks[view].map(([name, label]) =>
          <button type="button" key={name} disabled={busy} onClick={() => onView(name)}>{label}</button>)}
      </nav>
    </section>
  );
}
