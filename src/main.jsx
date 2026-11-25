import React from "react";
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { Workspace } from "./account/Workspace.jsx";
import "./account/workspace.css";
import { App } from "./App.jsx";
import { StoreProvider } from "./hooks/useStore.jsx";
import { initTheme } from "./hooks/useTheme.jsx";
import "./styles/app.css";
import { startUpdates } from "./updates/service.js";

// Убираем splash с первого экрана сразу после первого кадра (как в готовой сборке).
requestAnimationFrame(() => {
  const boot = document.getElementById("boot");
  if (boot) boot.remove();
});

// Тема применяется до рендера React, чтобы не было белой вспышки.
const accountBuild = import.meta.env.MODE === "accounts";
if (!accountBuild) initTheme();

createRoot(document.getElementById("root")).render(
  accountBuild ? <Workspace /> : <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);

// Service Worker регистрируется только в production-сборке: в dev-режиме его кеш
// мешал бы HMR. Пути относительные — работают и в корне, и в /phonebooks/.
if (!accountBuild && import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void startUpdates();
  });
}
