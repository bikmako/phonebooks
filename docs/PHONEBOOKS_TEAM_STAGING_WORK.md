# PhoneBooks Team. Развёртывание и восстановление staging для Work

Выполнять на проверенном SHA из [черновика PR #10](https://github.com/bikmako/phonebooks/pull/10), ветка `feat/phonebooks-2-solo-team`. Цель — существующий Supabase `phonebooks-staging` и отдельный Worker `phonebooks-team-staging`. Пилот использует синтетические данные. Действующие публикации, реальные клиентские базы и PR #9 в проверку не входят.

## 1. Доступ и переменные

В консоли аккаунта сверить имя проекта, идентификатор `maenpxxckszeaircuqmr`, целевой Worker и рабочую ветку. Если открылась другая инфраструктура, остановить внешние действия и продолжить локальный прогон. Ответ 401 с публичного URL Auth подтверждает доступность шлюза. Для миграций нужны права на конкретный staging-проект.

| Где | Имя | Значение |
| --- | --- | --- |
| Work | `PHONEBOOKS_STAGING_REF` | Идентификатор подтверждённого staging-проекта. |
| Work | `SUPABASE_ACCESS_TOKEN` | Секрет для Supabase CLI при запуске без интерактивной авторизации. |
| Work | `PGSERVICEFILE` | Путь к защищённому файлу libpq за пределами репозитория. Запись `phonebooks_staging` использует SSL и подтверждённый direct endpoint или session pooler. Пароль хранится в защищённом файле libpq или в хранилище секретов Work. |
| Work | `PHONEBOOKS_SECURE_BACKUP_DIR` | Существующий каталог резервных копий вне репозитория с ограниченным доступом и шифрованием. |
| Worker | `SUPABASE_URL` | HTTPS URL API того же staging-проекта. |
| Worker | `SUPABASE_PUBLISHABLE_KEY` | Ключ publishable того же проекта. Worker передаёт токен конкретного пользователя. |
| Worker | `PHONEBOOKS_SOLO_URL` | Адрес доступной копии Solo на другом имени хоста. |
| Worker | `PHONEBOOKS_IMPORT_KEY` | Случайный ключ не короче 32 символов. Предпочтительно 32 случайных байта, закодированных hex. Один экземпляр ключа хранится в Worker, в БД хранится SHA-256. |
| Worker | `TURNSTILE_SITE_KEY` | Публичный ключ виджета, если CAPTCHA включена в Supabase Auth. Секрет Turnstile вводится только в Supabase. |
| Сборка тестовой Solo | `VITE_PHONEBOOKS_TEAM_URL` | Подтверждённый HTTPS адрес Team staging. У обычной сборки Solo переменная пустая. |

Использовать секреты окружения или интерфейс провайдера. Значения SMTP, пароль БД, токены аккаунта и ключ переноса не помещать в файлы репозитория, описание PR и вывод консоли. Клиентская сборка не использует `service_role`. Для PostgreSQL проверить способ подключения по документации, для Worker использовать настройки секретов. [Supabase PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres), [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## 2. Проверка и миграции

1. На подтверждённом SHA запустить `npm ci`, `npm test`, `npm run test:team`, `npm run test:updates`, `npm run build` и `npm run build:team`. CI выполняет PostgreSQL 17 с отдельными соединениями и временной базой восстановления.
2. Создать контрольную копию из раздела 5. Отключить пользовательские записи на staging на время изменений. Зафиксировать SHA старого Worker и результаты сверки склада, кассы, проводок, членства и прав.
3. Привязать CLI только к существующему staging. Сверить журнал миграций и прогноз обновления. Выполнить применение после проверки целевого проекта.

```sh
supabase link --project-ref "$PHONEBOOKS_STAGING_REF"
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

Миграции `001`–`008` задают изоляцию, аккаунты, приглашения, бизнес-операции, права и журнал. `009` создаёт закрытое временное хранилище частей. `010` вводит индексы и постраничный API. Если журнал отмечает миграцию, которой нет в ветке, или одни и те же версии имеют разные определения, сохранить вывод и сверить историю до применения. [Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations)

4. После `005` настроить ключ переноса на подтверждённом staging. Запустить psql с уже заданным секретом Work, используя закрытую сессию с отключённой трассировкой shell.

```sql
\getenv import_key PHONEBOOKS_IMPORT_KEY
insert into phonebooks_team_private.solo_import_config (singleton,key_hash)
values (true,sha256(convert_to(:'import_key','UTF8')))
on conflict (singleton) do update set key_hash=excluded.key_hash;
\unset import_key
```

5. Настроить указанные переменные только у Worker `phonebooks-team-staging`. Прогнать упаковку локально. После успешного dry run и сверки имени Worker можно выполнить ту же команду без `--dry-run` в выделенном staging.

```sh
npm run build:team
npx --yes wrangler@4.167.0 deploy --config wrangler.phonebooks-team.toml --dry-run
```

6. До переноса синтетической копии назначить часовую уборку временных частей через действующий планировщик staging под владельцем миграции. При наличии `pg_cron` создать именованное задание один раз и проверить его результат в журнале Supabase Cron. Окно возобновления составляет 24 часа, а удаление просроченных частей происходит на ближайшем прогоне уборки.

```sql
select cron.schedule('phonebooks-prune-transfers', '15 * * * *',
  $job$select phonebooks_team_private.prune_transfer_uploads();$job$);
```

Дальнейшие миграции применяются в порядке имён. Для проверки таблиц после миграций 014–016 используйте [сценарии импорта, отката и экспорта](PHONEBOOKS_SPREADSHEETS.md).

## 3. Supabase Auth и SMTP

1. Включить Email и обязательное подтверждение адреса. Установить Site URL точному HTTPS адресу staging Worker без завершающего слеша. Проверить в разрешённых Redirect URLs только используемые адреса. Сохранить текущие значения до изменения, если тот же staging уже обслуживает другой прогон.
2. Установить тексты подтверждения и восстановления из `supabase/templates/confirmation.html` и `supabase/templates/recovery.html`. Ссылки с `TokenHash` открывают `/?view=confirm` или `/?view=reset` на Team. Приложение подтверждает действие после клика пользователя.
3. Настроить имеющийся SMTP в Auth. Нужны разрешённый адрес отправителя, хост, порт и учётные данные провайдера. Проверить доставку на отдельные тестовые ящики. Если SMTP доступен только после платного подключения или нет разрешения на домен отправителя, зафиксировать ограничение. Встроенная почта Supabase имеет ограничения для внешних адресатов. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [шаблоны Auth](https://supabase.com/docs/guides/auth/auth-email-templates)

Если проект Auth используется прежним стендом аккаунтов, сохранить его Site URL и текущие шаблоны. Добавить точный HTTPS-адрес Team с завершающим слешем в Redirect URLs. Team передаёт этот адрес как `redirect_to` при регистрации, повторной отправке и восстановлении. В каждом шаблоне ветка `{{ if eq .RedirectTo "https://team-staging.example/" }}` формирует письмо Team со ссылкой на `{{ .RedirectTo }}?view=confirm#{{ .TokenHash }}` или `?view=reset#{{ .TokenHash }}`. Ветка `{{ else }}` сохраняет прежнее письмо. Заменить адрес в условии точным адресом Team staging и проверить оба направления.

### Запуск Team на Render

Использовать отдельный Web Service с планом Free и веткой `feat/phonebooks-2-solo-team`. Команда сборки `npm ci --include=dev && npm run build:team`, команда запуска `node server/render-team-staging.js`. Render передаёт `RENDER_EXTERNAL_URL` и `PORT`. Задать ключ publishable, секрет переноса, адрес Solo staging и при необходимости публичный ключ Turnstile. Адаптер вызывает тот же Worker и использует тот же Supabase staging. Отдельная БД и диск на Render не нужны. SMTP обслуживает Supabase Auth.

## 4. Приёмка перед пилотом

- **Auth.** Регистрация и письмо, ссылка после использования и истечения, восстановление пароля, вход, выход, завершение других сессий. Проверить в реальном почтовом ящике и со второго устройства.
- **Права.** Создать два независимых предприятия, владельца, управляющего и сотрудника. Попробовать прямые запросы со своим токеном и чужим пространством, после отзыва доступа, с неразрешённой ролью, с подменой ID пользователя. Закупочная цена, себестоимость, касса, отчёты и журнал выдаются по правам.
- **Склад и касса.** Параллельно провести закупку и ремонт с одной версией карточки, продажу последней единицы и два расхода сверх доступной суммы. Повторить уже проведённый запрос. Ожидаются один результат на конфликт и согласованные остатки.
- **Перенос.** В пустое пространство загрузить синтетическую копию с подготовленным объёмом более 4 МиБ. Оборвать сеть после подтверждённой части, перезагрузить страницу, выбрать тот же файл и продолжить. Проверить контрольную сумму фрагмента и всего набора, отмену до публикации, повтор квитанции и сохранение исходной Solo. Размер выбранного файла ограничен форматом копий Solo, а передаваемый после разбора объём — 12 МиБ. Данные браузерного профиля и черновики не входят в передачу. Часть — 384 КиБ. Прогнать уборку временных частей после 24 часов через `select phonebooks_team_private.prune_transfer_uploads();` от администратора базы.
- **Синхронизация.** Прогнать 2, 5, 10 и 20 отдельных сессий на staging. Замерять p50/p95 по HTTPS, задержку появления изменения на втором устройстве, объём ответов, ошибки и счётчики Worker. Сверить результаты с CI. Нынешний альтернативный механизм опрашивает ревизии каждые четыре секунды в видимой вкладке и сразу после восстановления связи. Пустой опрос пропускает повторную сборку итогов. При непрерывной видимости 20 вкладок это около 300 запросов синхронизации в минуту, до дополнительного трафика панели команды, авторизации и операций. Сверить возможности действующего бесплатного окружения. При превышении бюджета или задержки уменьшить холостой трафик либо подключить Realtime как сигнал к подтверждённой сервером выборке. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- **Устройства.** Проверить установленную PWA на физических iPhone и Android, офлайн-запуск Solo, повтор запроса после потери связи и очистку Team после смены прав. Записать модели устройств, версии браузеров и результаты отдельно от эмуляции.

## 5. Контрольная копия и восстановление

1. Перед применением миграций остановить новые операции только на staging. В согласованное окно записать версию PostgreSQL, SHA приложения, последние версии миграций и контрольные числа. Проверить, какие штатные средства резервного копирования доступны в настройках конкретного проекта. [Supabase backups](https://supabase.com/docs/guides/platform/backups)
2. Выгрузить схему и записи приложения в закрытый каталог с зашифрованным хранением. В отдельный закрытый файл для локальной репетиции выгрузить только ID, тестовый адрес и статус подтверждения участников. Контрольная копия включает роли, права и квитанции. Пароли и действующие сессии Auth в локальную репетицию не переносятся. В конфигурации Team дамп содержит хеш секрета переноса и деловые данные, его хранить как чувствительный.

```sh
psql 'service=phonebooks_staging' -X -v ON_ERROR_STOP=1 -c 'show server_version;'
pg_dump 'service=phonebooks_staging' --format=custom \
  --schema=phonebooks_team_private --schema=public \
  --file="$PHONEBOOKS_SECURE_BACKUP_DIR/team-staging.dump"
pg_restore --list "$PHONEBOOKS_SECURE_BACKUP_DIR/team-staging.dump"
(cd "$PHONEBOOKS_SECURE_BACKUP_DIR" && sha256sum team-staging.dump > team-staging.dump.sha256)

psql 'service=phonebooks_staging' -X -v ON_ERROR_STOP=1 -c \
  "\copy (select id, email, email_confirmed_at from auth.users where id in (select user_id from phonebooks_team_private.memberships)) to stdout with (format csv, header)" \
  > "$PHONEBOOKS_SECURE_BACKUP_DIR/team-staging-identities.csv"
```

3. Восстанавливать в новую изолированную БД с PostgreSQL той же основной версии. Убедиться, что `phonebooks_restore` указывает на одноразовую локальную базу. В пустой базе убрать стандартную схему `public` без `CASCADE`, поскольку архив создаст её. Для локальной репетиции в одноразовом кластере создать роли `anon` и `authenticated` и выполнить SQL из `authSchema` в `tests/postgres/team-concurrency.test.js`. Затем импортировать `team-staging-identities.csv` по команде `\copy auth.users (id,email,email_confirmed_at) from '<защищённый путь>/team-staging-identities.csv' with (format csv, header)` из локального psql. Для стенда Supabase способ восстановления Auth и обслуживаемых схем проверяется отдельно.

```sh
(cd "$PHONEBOOKS_SECURE_BACKUP_DIR" && sha256sum -c team-staging.dump.sha256)
psql 'service=phonebooks_restore' -X -v ON_ERROR_STOP=1 -c 'drop schema public;'
pg_restore --exit-on-error --single-transaction --no-owner \
  --dbname='service=phonebooks_restore' \
  "$PHONEBOOKS_SECURE_BACKUP_DIR/team-staging.dump"
psql 'service=phonebooks_restore' -X -v ON_ERROR_STOP=1 \
  -c 'grant usage on schema public to authenticated;'
```

4. Сверить количества товаров, партий, проводок, счётчиков и отзывов доступа, общую и индивидуальную статистику, кассу, выборку разрешённых полей и журналы. Провести денежную операцию и проверить повтор её квитанции. Повторить через настоящий Auth на staging с новыми сессиями. После успешной сверки обновить сессию и проверить права нескольких устройств.
5. При сбое публикации остановить записи на staging и вернуть проверенный SHA Worker. Если старый Worker обращается к прежнему API, в большом пространстве следует использовать версию с поддержкой страниц. При повреждении данных отработать проверенное восстановление в изоляции и сверить результат перед переключением стенда. Зафиксировать последнее принятое решение, SHA, дату и результат. Восстановление на действующем staging выполняется только после проверки источника и цели, сохранения его текущего состояния и явного решения владельца окружения.
