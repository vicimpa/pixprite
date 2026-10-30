# Безопасность расширений

## Граница исполнения

`ExtensionHost` компилирует только исходники пакета и встроенную копию самостоятельного `@pixprite/api`. Worker создаётся внутри скрытого `srcdoc` iframe с `sandbox="allow-scripts"`, без `allow-same-origin`. Панели и widgets используют такую же opaque-origin границу. Код расширения не получает DOM редактора, его IndexedDB, localStorage или JS-объекты модели. Связь Worker → relay → редактор идёт по выделенному MessagePort; сообщения панели принимаются только от подключённого `contentWindow`.

Разрешения проверяются в host при каждом RPC, независимо от клиентской библиотеки. Доступ к содержимому через события также требует `sprite:read`; встроенные команды имеют дополнительную проверку разрешений. Callback регистрирует только Worker. Подключение панели требует `ui:panel`.

Relay и panel HTML получают CSP до любого содержимого пакета: прямые `fetch`, WebSocket и другие `connect-src` запросы запрещены; внешние скрипты, изображения, стили, формы и вложенные страницы также запрещены. Допускаются скомпилированные blob-скрипты, inline-скрипты/стили и локальные data/blob ресурсы. Worker наследует CSP создавшего его документа, включая ограничения динамического `import`. Это browser enforcement, а не подмена `fetch` в JS.

Разрешённая сеть проходит через `ctx.net.fetch`: точное совпадение URL host, включая нестандартный port, с `network:<host>` либо `network:*`; HTTPS и HTTP только для localhost/127.0.0.1. Редактор не передаёт cookies/credentials/referrer, запрещает redirects и отменяет незавершённый fetch при остановке host. Даже если перенаправление ведёт на разрешённый host, оно отклоняется. Встроенный клиент API остаётся отдельным пакетом; исходники независимых AI assistant/game-rig не менялись.

## Пакеты и жизненный цикл

Manifest проверяет типы, версию API, permissions и каждый путь entry/icon/contribution. Имена файлов не содержат `..`/`.` сегменты, backslash, percent encoding, scheme, ведущий slash, query, fragment или управляющие символы. Импорты могут использовать `../` внутри пакета, но не выходить выше корня; компилятор отклоняет внешние литеральные импорты. Те же проверки действуют для loose files, registry lists и dev reads; относительные ресурсы panel HTML проверяются до чтения.

Для пакета со списком файлов обязателен корректный SHA-256 каждого файла, включая manifest. Невалидный JSON, null/array вместо списка, некорректный хеш, неподходящий путь или несовпадение digest останавливают установку до сохранения/старта. Только HTTP 404/410 допускают legacy-пакет без `files.json`; HTTP ошибки и network errors не ослабляют проверку. Registry integrity проверяет список, а без списка — manifest. Сам список без доверенного внешнего integrity обеспечивает согласованность файлов, но не подтверждает издателя. Loose/dev пакеты не подписаны.

`activate` имеет deadline 10 секунд, вызов callback/export — 60 секунд. Ошибка Worker после activation и callback timeout переводят host в `failed` и выполняют общий idempotent dispose. Он отменяет открытые history guards/транзакции и stroke, отклоняет ожидающие вызовы, очищает callbacks, команды и event subscriptions, закрывает MessagePort и удаляет relay с Worker. При явном stop действует такой же cleanup. Ответы и запросы от остановленных/отключённых endpoints игнорируются; late disposer выполняется сразу. Декодирование `documents.open`, завершившееся после stop, проверяет lifetime перед изменением редактора.

Исключение внутри `ctx.sprite.transaction` отменяет именно её изменения и восстанавливает undo/redo. Авария или timeout отменяет все открытые транзакции этого host. Уже committed правки остаются обычными undo-шагами.

## Проверяемые сценарии

`src/core/extensions/security.test.ts` проверяет полную permission-таблицу, точное сопоставление network host, поля manifest и нормализацию путей. `e2e/security.e2e.ts` содержит 10 production-browser тестов с реальными Worker/iframe, компиляцией, RPC, registry загрузкой и IndexedDB браузера. Они помечены `@smoke`: запускаются обычным CI шагом `bun run test:e2e:smoke` и полным `bun run test:e2e`.

`e2e/server.ts` перед запуском собирает оптимизированный harness в `.extension-dist` с production Vite-конфигурацией. Harness экспортирует только диагностическое управление тестом; в shipping `dist/` он не попадает. Подмена handler/Worker для доказательства sandbox не используется. Playwright clock ускоряет только deadline-тесты; реальные контексты Worker и iframe сохраняются. Сетевой fixture считает дошедшие до сервера запрещённые запросы, включая WebSocket handshake.

| Пункт PLAN | Доказательство |
| --- | --- |
| Запрет API без разрешения | Unit: все защищённые методы; browser: девять запрещённых ctx-вызовов, сырой panel RPC |
| Network allowlist | Exact host/port, suffix/credentials, разрешённый fetch без cookie/referrer, запрещённые scheme/redirect; raw Worker fetch/WebSocket не доходят до сервера |
| Изоляция Worker | Нет document/parent, origin `null`, external dynamic import блокируется CSP |
| Изоляция iframe | Доступ к parent DOM даёт SecurityError; raw fetch/WebSocket/image блокируются |
| IndexedDB редактора | `indexedDB.open` из настоящих Worker и panel даёт SecurityError; editor-origin DB создаётся отдельно |
| Path traversal | Manifest поля, файловые списки, loose package, dev read и реальные compiler imports; escape URL не запрашивается |
| Повреждённый manifest | Unit malformed structures и browser malformed registry JSON не сохраняются/не запускаются |
| Неправильные хеши | Digest manifest/file/list, отсутствие manifest hash, malformed list и HTTP503 отклоняются; корректный пакет запускается |
| Зависший activate | Через 10 секунд failed; нет команды, subscriptions, callbacks и relay |
| Зависший callback | Через 60 секунд failed, cleanup и rollback; pending invoke отклонён |
| Отмена транзакции | Исключение после реальной записи пикселей восстанавливает pixels/undo/redo и освобождает guard |
| Очистка команд/обработчиков | Проверяется после stop, timeout и crash; поздний panel RPC не восстанавливает регистрации |
| Rollback после сбоя | Uncaught Worker exception после записи откатывает открытую транзакцию и освобождает host; отдельный late document decode не открывает новый документ |

## Реальные ограничения

Это не обещание полной сетевой изоляции произвольного враждебного браузерного кода. Sandbox запрещает навигацию top-level, но сам iframe может навигировать собственный browsing context; meta CSP не даёт надёжного cross-browser запрета такой навигации. WebRTC/STUN и побочные каналы также не покрыты network allowlist. Запреты и browser tests выше относятся к RPC, connect/resource loading и origin storage. Установка расширения всё ещё требует доверия к издателю; сетевые разрешения описывают host API, а не универсальный no-exfiltration контейнер.

Timeout — deadline, а не лимит CPU/памяти. Worker не даёт зависшему JS заблокировать editor main thread; бесконечный JS panel iframe может блокировать общий renderer в зависимости от браузера. CSP не ограничивает объём созданных Blob/буферов. Набор регрессий исполняется в Chromium; другие движки требуют отдельной проверки. API `net.fetch` проверяет размер уже прочитанного тела, не вводит потоковый лимит памяти. Остановка host не отменяет уже завершённые записи, уже отправленные внешние запросы или пользовательские действия в ранее открытом встроенном диалоге. Откатываются открытые extension-транзакции, а не весь документ с момента старта расширения.
