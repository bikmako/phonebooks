import React from "react";
import { App } from "../App.jsx";
import { StoreProvider, useStore } from "../hooks/useStore.jsx";
import { initTheme } from "../hooks/useTheme.jsx";
import { startUpdates } from "../updates/service.js";
import { flushUpdateDrafts } from "../utils/drafts.js";
import { accessLease, canRead } from "./access.js";
import { bindAccountStorage } from "./storageScope.js";

const SESSION_SIGNAL = "pb-account-session-event";
const OFFLINE = "Без связи · просмотр и экспорт";
const EXPIRED = "Доступ истёк · просмотр и экспорт";
const sessionMarker = () => {
  try { return localStorage.getItem(SESSION_SIGNAL); } catch { return null; }
};
const VERIFYING = "Проверяем доступ · просмотр и экспорт";

async function fetchAccount() {
  const check = async () => {
    const response = await fetch("/api/session", {
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: "{}", signal: AbortSignal.timeout(10000),
    });
    if ([401, 403].includes(response.status)) return null;
    if (!response.ok) throw new Error("Сервис аккаунтов недоступен.");
    return response.json();
  };
  return navigator.locks ? navigator.locks.request("pb-auth-refresh", check) : check();
}

export function Workspace() {
  const [account, setAccount] = React.useState(null);
  const [note, setNote] = React.useState("");
  const [locked, setLocked] = React.useState(false);
  const [revision, render] = React.useReducer(n => n + 1, 0);
  const lease = React.useRef(null);
  const connected = React.useRef(false);
  const accessChanged = React.useRef(false);
  const initialMarker = React.useRef(sessionMarker());

  const viewAccess = React.useCallback(() => {
    if (accessChanged.current || initialMarker.current !== sessionMarker() || !lease.current) return { read: false, write: false };
    return lease.current.state(connected.current && navigator.onLine);
  }, []);
  const authorizeWrite = React.useCallback(() => viewAccess().write, [viewAccess]);

  React.useEffect(() => {
    let live = true;
    let request;
    let updateStarted = false;
    const lock = () => {
      try { flushUpdateDrafts(); } catch {}
      accessChanged.current = true;
      connected.current = false;
      setLocked(true);
    };
    function refresh() {
      if (initialMarker.current !== sessionMarker()) { lock(); return; }
      if (accessChanged.current || request || !navigator.onLine) return;
      request = (async () => {
        try {
          const result = await fetchAccount();
          if (!live || accessChanged.current) return;
          if (!result || !canRead(result.status) || (lease.current && lease.current.account.id !== result.id)) {
            lock();
            return;
          }
          if (!lease.current) {
            try {
              bindAccountStorage(result.id);
              initTheme();
            } catch {
              lock();
              return;
            }
          }
          lease.current = accessLease(result);
          connected.current = true;
          document.documentElement.classList.remove("pb-background");
          setAccount(result);
          setNote("");
          if (!updateStarted && "serviceWorker" in navigator) {
            updateStarted = true;
            void startUpdates();
          }
        } catch (error) {
          if (!live) return;
          connected.current = false;
          setNote(error.message);
        } finally {
          request = null;
          if (live) render();
        }
      })();
    }
    const pause = () => { connected.current = false; render(); };
    const recheck = () => { pause(); refresh(); };
    const background = () => document.documentElement.classList.add("pb-background");
    const visible = () => { if (document.visibilityState === "visible") recheck(); };
    const onStorage = event => { if (event.key === SESSION_SIGNAL) lock(); };
    if (!navigator.onLine) setNote("Для первого открытия требуется интернет.");
    refresh();
    const heartbeat = setInterval(refresh, 15000);
    const clock = setInterval(render, 1000);
    window.addEventListener("offline", pause);
    window.addEventListener("online", recheck);
    window.addEventListener("pageshow", recheck);
    window.addEventListener("pagehide", background);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      clearInterval(heartbeat);
      clearInterval(clock);
      window.removeEventListener("offline", pause);
      window.removeEventListener("online", recheck);
      window.removeEventListener("pageshow", recheck);
      window.removeEventListener("pagehide", background);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const access = viewAccess();
  if (!account) return <div className="pb-workspace-lock" role="status">
    <h1>PhoneBooks</h1>
    <p>{locked ? "Войдите, чтобы открыть бухгалтерию." : note || "Проверяем доступ…"}</p>
    {(locked || note) && <a href="/account">Перейти в аккаунт</a>}
  </div>;
  return <StoreProvider readOnly={!access.write} authorizeWrite={authorizeWrite}>
    <WorkspaceBody access={access} offline={!navigator.onLine || Boolean(note)} revision={revision} />
  </StoreProvider>;
}

function WorkspaceBody({ access, offline, revision }) {
  const { prepareForUpdate } = useStore();
  const [notice, setNotice] = React.useState("");
  const closing = React.useRef(false);
  React.useEffect(() => {
    if (access.read || closing.current) return;
    closing.current = true;
    // Cover data immediately, then finish operations accepted before the lock.
    let release;
    prepareForUpdate().then(unlock => {
      release = unlock;
      flushUpdateDrafts();
      location.replace("/account");
    }).catch(error => {
      release?.();
      closing.current = false;
      setNotice(error.message);
    });
  }, [access.read, prepareForUpdate, revision]);

  async function openAccount(event) {
    event.preventDefault();
    let release;
    try {
      release = await prepareForUpdate();
      flushUpdateDrafts();
      location.assign("/account");
    } catch (error) {
      release?.();
      setNotice(error.message);
    }
  }
  if (!access.read) return <div className="pb-workspace-lock" role="alert">
    <h1>Рабочее пространство закрыто</h1>
    <p>{notice || "Сохраняем принятые изменения перед выходом…"} </p>
    {notice && <p>Уже записанные данные сохранены на этом устройстве.</p>}
  </div>;

  const banner = !access.write ? (access.expired ? EXPIRED : offline ? OFFLINE : VERIFYING) : access.reminder;
  return <>
    <div className="pb-account-bar">
      <span role="status">{notice || banner || "PhoneBooks Pro"}</span>
      <a href="/account" onClick={openAccount}>Аккаунт</a>
    </div>
    <App />
  </>;
}
