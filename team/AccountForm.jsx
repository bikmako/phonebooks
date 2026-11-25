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

export function AccountForm({ view, siteKey, busy, onSubmit, onView }) {
  const [captcha, setCaptcha] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const callback = view === 'confirm' || view === 'reset';
  const needsEmail = !callback && view !== 'password';
  const needsPassword = ['register', 'login', 'password'].includes(view);
  const verify = needsEmail && Boolean(siteKey);
  return (
    <section aria-labelledby="account-title">
      <h2 id="account-title">{labels[view]}</h2>
      <form onSubmit={async event => {
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
        <button disabled={busy || (verify && !captcha)}>{actions[view]}</button>
      </form>
      <nav className="account-nav" aria-label="Действия с аккаунтом">
        {Object.entries({ login: 'Ко входу', register: 'Создать аккаунт', recover: 'Забыли пароль?', resend: 'Отправить письмо подтверждения повторно' })
          .filter(([name]) => name !== view)
          .map(([name, label]) => <button className="secondary" type="button" key={name} disabled={busy} onClick={() => onView(name)}>{label}</button>)}
      </nav>
    </section>
  );
}
