# Включение GitHub Pages для PhoneBooks

> Этот файл — инструкция. Ни commit, push, PR, ни публикация при подготовке не выполнялись.
> Выполнять шаги ниже нужно только после отдельного разрешения пользователя.

## Текущее состояние репозитория (проверено через GitHub API)

- `bikmako/phonebooks`, public, default branch `main`, не archived, не disabled.
- Pages уже включены, но источник **legacy**: `Deploy from a branch` → `main` → `/ (root)`.
  Последняя сборка Pages: commit `b075e974603410dc4e6a94f713cfb9b9966b9702`, status `built`.
  Сейчас сайт отдаёт оригинальную статическую сборку из корня `main`.
- Адрес сайта уже существует: <https://bikmako.github.io/phonebooks/>.
- Окружение `github-pages` уже создано; у него deployment branch policy = `main`
  (деплой с других веток запрещён).
- В `.github/workflows/` на `main` файлов ещё нет; есть только динамический
  `pages-build-deployment` от старого способа Pages.
- Настройки `Actions permissions` / `Workflow permissions` / branch protection
  через доступный в песочнице GitHub App прочитать не удалось (HTTP 403
  «Resource not accessible by integration»). Их нужно проверить в UI, см. шаг 2.

## Что делает добавленный workflow

`.github/workflows/deploy-pages.yml`:

1. Триггеры: `push` в `main` и ручной `workflow_dispatch`.
2. `npm ci` по `package-lock.json`, Node.js 20.
3. `actions/configure-pages@v5` определяет `base_path=/phonebooks`.
4. `npm run build -- --base /phonebooks/` — явный base для project Pages.
5. Проверяет `dist/index.html`, `dist/sw.js`, `dist/404.html`,
   `dist/manifest.webmanifest`, `dist/.nojekyll` и наличие `/phonebooks/` в путях.
6. `actions/upload-pages-artifact@v3` загружает `dist` как артефакт
   (v3 сохраняет скрытые `.nojekyll`).
7. `actions/deploy-pages@v5` публикует артефакт в окружение `github-pages`.

Используются только официальные actions GitHub; PAT/секреты не нужны —
достаточно `GITHUB_TOKEN` с `pages: write` и `id-token: write`.

## Что нужно нажать в GitHub

### Шаг 0. Сначала доставить файлы в `main`

Без отдельного разрешения агент не делает commit/push/PR. После разрешения:

1. Агент коммитит изменения на текущую ветку `arena/f97f5c94-phonebooks`
   и push'ит **только её** (никогда не `main`).
2. **Вы** открываете PR из `arena/f97f5c94-phonebooks` → `main` и мержите его
   (или поручаете это агенту отдельным явным разрешением).
3. В `main` должны оказаться как минимум: `.github/workflows/deploy-pages.yml`,
   `package.json`, `package-lock.json`, `app.html`, `vite.config.js`, `src/`,
   `public/`. Оригинальные 19 файлов root-сборки и `backup/original-build/`
   остаются нетронутыми.

### Шаг 1. Проверить настройки Actions

`Settings` → `Actions` → `General`:

- **Actions permissions**: включите `Allow all actions and reusable workflows`
  (или как минимум разрешите actions, созданные GitHub).
- **Workflow permissions**: рекомендуется `Read and write permissions`.
  Workflow сам явно запрашивает `pages: write` и `id-token: write`, но если
  репозиторий/организация жёстко ограничивает права, деплой не пройдёт.
- Нажмите **Save**, если кнопка появилась.

### Шаг 2. Переключить источник Pages

`Settings` → `Pages` → блок **Build and deployment**:

- Сейчас выбрано **Deploy from a branch** (`main`, `/ (root)`).
- В выпадающем списке **Source** выберите **GitHub Actions**.
- Если появится кнопка **Save** — нажмите её.
- Если GitHub предложит «suggested workflows» — **не создавайте новый workflow**:
  нужный уже лежит в `.github/workflows/deploy-pages.yml`.
- **Custom domain** оставьте пустым (сейчас домен не задан).

После переключения старый динамический `pages-build-deployment` перестанет быть
источником сайта; сайт будет обновляться нашим workflow. Оригинальные файлы в
репозитории при этом не удаляются и не меняются.

### Шаг 3. Запустить первую публикацию

Вариант A (автоматический): после merge в `main` workflow запустится сам
по событию `push`.

Вариант B (вручную): `Actions` → слева **Deploy PhoneBooks to GitHub Pages** →
**Run workflow** → ветка **main** → зелёная кнопка **Run workflow**.

> Не запускайте workflow вручную с ветки `arena/f97f5c94-phonebooks`:
> окружение `github-pages` разрешает деплой только из `main`, и шаг
> `Verify deployment ref` остановит запуск с понятной ошибкой.

### Шаг 4. Дождаться результата

В Actions должна появиться зелёная галочка у job **Deploy**.
Затем откройте:

<https://bikmako.github.io/phonebooks/>

Адрес не меняется: это project Pages, поэтому путь `/phonebooks/` остаётся.
Роутинг внутри приложения hash-based (`#/dashboard`, `#/purchase`, …),
поэтому серверных rewrite не требуется; `404.html` из `dist` редиректит
неизвестные пути обратно на `/phonebooks/#/dashboard`.

## Что остаётся за пользователем

- Разрешить commit/push текущей ветки и merge PR в `main`.
- Проверить/включить настройки Actions из шага 1.
- Переключить **Source** на **GitHub Actions** в шаге 2.
- При желании нажать **Run workflow** в шаге 3 (или дождаться auto-deploy после merge).
- Убедиться, что сайт открывается по ссылке выше.

Агент не публиковал, не пушил, не открывал PR и не включал Pages.
