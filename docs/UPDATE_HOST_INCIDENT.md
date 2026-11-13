# Cloudflare Pages: обновление не доходит до waiting

Проверка стенда https://phonebooks-update-test.pages.dev/phonebooks/ выполнена 14 ноября 2026 (UTC+5), без публикации на него.

## Причина и доказательства

Из исходного Actions artifact 14045752263 скачаны все три ZIP:

| Архив | VERSION/CACHE | SHA-256 sw.js |
|---|---|---|
| 01 | phonebooks-v9-0efdf641 | 7687580019c9d1e42299b55512446aa90c53d385d4a016e2f808ca3d8e480cde |
| 02 | phonebooks-v9-9d273a09a51c3ca1 | 5033d7e4c5ed9a872a61aeef1fa85086142b5a09d96ac8043f9be9395fba3bb7 |
| 03 | phonebooks-v9-a770587095f17fb3 | 8b3e070b20755db17133342bade3090176f05761807e956469ccdfe6c6a6fe4f |

Worker на стенде совпал с 03 по SHA-256; /test-build.json подтверждает stage 03 и исходный коммит 15cd256. В 03 изменён HTML и пересчитан worker. Повторная публикация одинаковых байтов не была причиной.

GET /phonebooks/sw.js: 200 application/javascript, Cache-Control: public, max-age=0, must-revalidate. GET /phonebooks/index.html: **308 Location: /phonebooks/**. После редиректа HTML совпадает с SHA-256 в worker. Остальные 21 ресурс тоже совпадают, возвращаются без редиректов. GET /phonebooks/: 200, HTML совпадает, без редиректа.

Свежий Chromium на реальном HTTPS-стенде через CDP ServiceWorker domain зафиксировал installing → redundant и `Uncaught (in promise) Error: Incomplete release` в sw.js:33. В чистом браузерном контексте после ошибки нет registration, controller и кешей. Это подтверждает сбой установки, а не скрытие готового уведомления.

Старый установщик запрещал `response.redirected` для всех ресурсов, включая index.html. Поэтому он удалял частичный кеш и отклонял install. На устройстве с активным legacy-worker тот остаётся активным; в новом документе React может уже загрузиться из сети, но новая оболочка так и не устанавливается. Перезапуск не исправляет повторяющийся ответ 308.

## Исправление

Worker запрашивает HTML сразу по URL scope (`/phonebooks/`), проверяет его SHA-256 и сохраняет под прежним ключом index.html. Для остальных ресурсов URL не меняется. Запрет редиректов, проверка всех байтов, согласие на активацию и IndexedDB остаются прежними. Ошибки установки и проверки теперь видны в консоли.

`registration.update()` и `inspectWaiting()` вызываются при запуске/событиях/периодически. Последний рекламирует только установленный, полностью подготовленный waiting-worker и проверяет ответ через MessageChannel. В исходном сбое такого worker нет: код до сообщений и UI не доходит. Автоматического skipWaiting в install нет. Откладывание на четыре часа действует только после «Позже», только на ту же версию; оно не объясняет installing → redundant.

Прежний тестовый HTTP-сервер отдавал index.html прямо с 200. Теперь он всегда воспроизводит 308 Cloudflare; вся существующая lifecycle-suite проверяет реальные worker с этим поведением. Добавлены отдельные проверки канонического HTML, удаления частичного кеша при редиректе ресурса и отказа при неверной сумме HTML. Read-only аудит хоста: `node tools/diagnose-update-host.js https://phonebooks-update-test.pages.dev/phonebooks/` (curl нужен в PATH).

## Границы проверки

На существующем внешнем HTTPS-хосте воспроизведён именно отказ исходного worker и проверены все ресурсы. Последовательная публикация исправленных 01→02→03 на внешнем хосте пока **не выполнена**: в окружении нет доступа к публикации Cloudflare Pages. Попытки получить отдельный HTTPS preview/tunnel не создали доступного хоста. Локальные проверки с воспроизведением 308 не подменяют этот шаг. Физический iPhone тоже требует ручной приёмки. Не считать выпуск подтверждённым до этой проверки.

## Повтор на ПК и iPhone

1. Возьмите **новый** набор ZIP из Actions на исправленном коммите PR #7 или подготовленные вместе с этим исправлением. Старые 02/03 не исправятся от повторной загрузки. Для полного чистого прогона создайте новый отдельный Direct Upload проект; существующий тестовый origin можно использовать для проверки восстановления без очистки его базы.
2. Production одного проекта: опубликуйте 01. Откройте именно `/phonebooks/` на стабильном production hostname; добавьте вымышленную покупку и скачайте тестовую копию. На iPhone проверьте Safari и отдельно ярлык тестовой PWA. Не используйте preview URL отдельных deployments.
3. Опубликуйте исправленный 02. На корневой странице `/` и `/test-build.json` проверьте этап. Сохраните тестовые формы, закройте все тестовые окна и снова откройте с сетью; при необходимости один раз перезагрузите тестовую страницу. Старый интерфейс не умеет показывать новое уведомление. Дождитесь загрузки оболочки; проверьте офлайн-запуск. На ПК в консоли проверьте `navigator.serviceWorker.controller` и build meta: контроллер должен существовать, build должен соответствовать 02. Сохранность одной покупки сама по себе не доказывает активацию нового worker.
4. **Оставьте 02 открытым**, затем опубликуйте исправленный 03 на тот же Production hostname. Проверьте `/test-build.json` вне приложения. Вернитесь в приложение с сетью; дайте не менее минуты после предыдущей проверки либо дождитесь периодической проверки (15 минут видимой работы). Не закрывайте все окна между публикацией и ожиданием уведомления: браузер вправе штатно активировать waiting-worker, когда клиентов уже нет.
5. Должно появиться «Доступно обновление». Перед нажатием закройте другие тестовые окна Safari/ПК/PWA этого origin; примените в одном окне. Проверьте одну перезагрузку, покупку, суммы, настройки, черновики, копию и повторный офлайн-запуск. На iPhone каждый режим Safari/PWA проверяйте отдельно, записывая версию iOS и число открытых окон.
6. Если нажимали «Позже», та же версия скрыта на четыре часа сессии. Для немедленной повторной проверки используйте следующий отличающийся этап, не очищайте Safari, IndexedDB или localStorage. Не включайте DevTools Update on reload/skipWaiting: это меняет проверяемый сценарий.

Безопасная диагностика ПК в консоли приложения:

```js
const r = await navigator.serviceWorker.getRegistration();
console.log({scope:r?.scope, active:r?.active?.state, installing:r?.installing?.state,
  waiting:r?.waiting?.state, controller:!!navigator.serviceWorker.controller,
  build:document.querySelector('meta[name="phonebooks-build"]')?.content});
await r?.update(); // запускает проверку, загрузка install может продолжиться после resolve
```

Если installing снова становится redundant, откройте консоль самого worker. Исправленная версия пишет конкретный URL/статус либо checksum mismatch. Для проверки MessageChannel у waiting-worker:

```js
const waiting = (await navigator.serviceWorker.getRegistration())?.waiting;
if (waiting) {
  const ch = new MessageChannel();
  const timer = setTimeout(() => { console.warn('UPDATE_STATUS timeout'); ch.port1.close(); }, 15000);
  ch.port1.onmessage = e => { clearTimeout(timer); console.log(e.data); ch.port1.close(); };
  waiting.postMessage({type:'UPDATE_STATUS'}, [ch.port2]);
}
```

Ожидаемый ответ: `{version: "phonebooks-v9-…", ready: true}`. Это не активирует worker и не меняет пользовательские данные.
