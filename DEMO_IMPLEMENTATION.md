# PhoneBooks: isolated sales demo (implementation brief)

Branch: `feat/isolated-sales-demo`. Base: current `main` after PR #5.

## Goal
Build a separate public **DEMO** distribution for potential buyers. Never change current production app behavior, user records, backup data, storage keys, or publishing pipeline.

## Requirements
1. Compile demo explicitly, e.g. `npm run build:demo` with a separate build mode/flag, and emit to a distinct directory. The default `npm run build` MUST stay byte-for-byte behavior compatible (functionality and storage naming).
2. Demo must be hosted on a **different origin** from the paid build (separate GitHub Pages repository or other separate domain), not just `/#/demo` or a query param. Demo storage is namespaced even on the separate origin (IndexedDB, localStorage drafts/themes, backup metadata, cache and Service Worker). Never migrate production legacy keys into demo.
3. Preload only synthetic sample data: multiple smartphones (in stock/sold), accessories, completed sales, financial accounts/expenses/cash operations, history. Prefer using existing domain functions to generate internally valid data. Use fake IMEI or empty IMEI values, never real clients' details.
4. Allow full exploration of phone intake, sales, accessories, finance, history, analytics, and IMEI camera scanner. Show persistent `ДЕМО` marker and short note `Тестовые данные · для ознакомления`.
5. No backup import/export or recovery of production files in demo. No cloud/real service integration; hide or disable the relevant UI and block calls at the API level. Prevent user data from leaving the demo through backup/transfer facilities.
6. Provide `Сбросить демо` button, with confirmation, that restores original synthetic dataset. Users' demo edits should be isolated and disposable. Settings should clarify that this is not real accounting and does not replace the purchased app.
7. Demo URL should have a clear CTA `Купить полную версию` linking to a configurable seller contact, not invented phone/Telegram handles. If none configured, do not produce a broken link.
8. Do not make subscription/cloud mandatory for the paid application. Preserve offline local-first PWA.
9. Include regression tests for noninterference: production DB_NAME remains `phonebooks`, demo DB differs, demo legacy migration skipped, demo import/export blocked, initial reset works, synthetic dataset integrity passes, scanner is accessible. Run production and demo build/tests and mobile Playwright flows.
10. Create PR to `main` for REVIEW ONLY. No merge, no GitHub Pages deployment, no Netlify changes until owner explicitly approves. Demo deployment must not overwrite production `https://bikmako.github.io/phonebooks/`.

## Architecture warnings
- `src/storage/db.js` hardcodes production IndexedDB name and legacy localStorage migration.
- `src/storage/fullBackup.js` and `src/components/settings/BackupPanel.jsx` implement full import/export. UI-only hiding is insufficient.
- `src/utils/drafts.js` and `src/hooks/useTheme.jsx` contain localStorage keys.
- `public/sw.js` and `vite.config.js` manage SW caches and asset paths. Isolate demo cache.
- `src/hooks/useStore.jsx` loads persisted records and handles reset. Demo initialization must never load or overwrite production records.
- `tests/fixtures/realistic.js` includes useful example domain API calls for generating valid synthetic test data. Avoid importing test fixtures into production code.

Acceptance: customer can visit separate demo origin, safely try existing capabilities, reset to synthetic data, and cannot access paid backup/transfer. Existing customers keep their exact data and functionality.
