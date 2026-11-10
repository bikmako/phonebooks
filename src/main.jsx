import React from "react";
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import { App } from "./App.jsx";
import { StoreProvider } from "./hooks/useStore.jsx";
import { initTheme } from "./hooks/useTheme.jsx";
import "./styles/app.css";

// Убираем splash с первого экрана сразу после первого кадра (как в готовой сборке).
requestAnimationFrame(() => {
  const boot = document.getElementById("boot");
  if (boot) boot.remove();
});

// Тема применяется до рендера React, чтобы не было белой вспышки.
initTheme();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);

// Service Worker регистрируется только в production-сборке: в dev-режиме его кеш
// мешал бы HMR. Пути относительные — работают и в корне, и в /phonebooks/.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  });
}
