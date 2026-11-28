# Полировка интерфейса PhoneBooks 2.0

Исходный снимок `e31fb25a76565bdcc7fec19d3cde329a3bbd61e9`. Скриншоты сняты в локальной Demo с одинаковыми синтетическими данными в Chromium, на 1280 и 320 px. Для истории Solo задана тёмная тема. Team сохраняет свою светлую тему.

## Изменения

- **Финансы.** Быстрые действия расположены выше периода, показателей и вторичной статистики. В Solo баланс оформлен нейтральной поверхностью. Приход и расход выделены только цветом суммы. В Team выше отчётов размещены действия, уже доступные текущей роли.
- **История.** Приход, расход и число операций собраны в общую нейтральную панель. Тонкие разделители заменяют цветные плашки. Заголовки дат и подсветка строк используют поверхности текущей темы.
- **Склад.** Заголовок, поиск и фильтры, действия, затем товары. Добавление выделено основной кнопкой, категория, массовое редактирование и экспорт используют вторичный стиль. На 320 px основная кнопка занимает ряд, короткие вторичные действия группируются по два.
- **Контролы.** У действий общие базовые высота, радиус и отступы. Соседние кнопки в финансах выравниваются по высоте при переносе текста. В нижней части модальных окон Solo согласованы кнопки, сохранены отступы безопасной зоны. В Team согласованы вторичные кнопки, текстовые ссылки-действия и перенос кнопок настроек.

## Снимки до и после

| Экран | ПК | 320 px |
| --- | --- | --- |
| Solo · Финансы | [До](ux-polish/before-solo-finance-desktop.png) / [После](ux-polish/after-solo-finance-desktop.png) | [До](ux-polish/before-solo-finance-320.png) / [После](ux-polish/after-solo-finance-320.png) |
| Solo · История, тёмная тема | [До](ux-polish/before-solo-history-dark-desktop.png) / [После](ux-polish/after-solo-history-dark-desktop.png) | [До](ux-polish/before-solo-history-dark-320.png) / [После](ux-polish/after-solo-history-dark-320.png) |
| Solo · Склад | [До](ux-polish/before-solo-stock-desktop.png) / [После](ux-polish/after-solo-stock-desktop.png) | [До](ux-polish/before-solo-stock-320.png) / [После](ux-polish/after-solo-stock-320.png) |
| Team · Финансы | [До](ux-polish/before-team-finance-desktop.png) / [После](ux-polish/after-team-finance-desktop.png) | [До](ux-polish/before-team-finance-320.png) / [После](ux-polish/after-team-finance-320.png) |
| Team · Склад | [До](ux-polish/before-team-stock-desktop.png) / [После](ux-polish/after-team-stock-desktop.png) | [До](ux-polish/before-team-stock-320.png) / [После](ux-polish/after-team-stock-320.png) |
| Team · История | [До](ux-polish/before-team-history-dark-desktop.png) / [После](ux-polish/after-team-history-dark-desktop.png) | [До](ux-polish/before-team-history-dark-320.png) / [После](ux-polish/after-team-history-dark-320.png) |

Браузерные проверки Demo фиксируют порядок склада и финансов, размеры соседних действий и отсутствие горизонтального переполнения. Дополнительно проверены обзор, продажи, ремонт, карточка товара, командный экран и диалог нового счёта. Для запуска используется `npm run test:demo`.
