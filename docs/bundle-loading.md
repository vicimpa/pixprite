# Bundle и загрузка

Граница редактора проходит между общим ядром документа и интерфейсом рабочего места. `State`, `Projects`, `Sprite`, валидация, восстановление, команды, обработчики клавиатуры, меню и React остаются в статическом графе: они нужны для восстановления сессии, команд Home и публичного Extension API. `EditorWorkspace` с canvas, timeline, панелями, инструментами интерфейса и preview загружается при открытии редактора. Это реальная граница `import()`, проверяемая по составу модулей, а не правило `manualChunks`. Единственное ручное группирование — общие React/runtime зависимости.

`Home` имеет отдельный entry. Магазин расширений загружается только при открытии через лёгкую функцию `openExtensions`; permissions, slots и проверка обновлений не импортируют его UI. Extension host запускается до проверки сохранённого языка и темы: установленные language/theme packs должны работать на первом экране. Поэтому host/compiler входят в фактический bootstrap Home, хотя находятся за динамическим импортом. Форма `ctx.ui.showForm` загружается только при вызове API.

Диалоги открываются через прежний `dialogs` API. New Sprite имеет собственный entry и не загружает общий набор редких диалогов. Properties/history/preferences/export/sheet UI находятся в `Common`; Filters, Palette, Stroke, Slice, Tilemap, Shortcuts и ColorMode имеют отдельные entries. Parameterized filter/color-mode operations вынесены в ядро: выполнение команды с аргументами не загружает JSX диалога. Общие свойства диалогов остаются вместе; разделение каждого маленького окна на отдельный файл не является целью этого блока.

Loading-диалог сразу блокирует клавиатурные команды; Escape/Cancel и возвращаемый close handle отменяют открытие даже до завершения запроса. Ошибка загрузки показывает Close/Retry. Workspace использует Suspense и error boundary с Retry, сохраняя оболочку и документ. Browser regressions проверяют задержанный импорт, отмену до его разрешения, offline-ошибку с повтором после reconnect и отказ editor chunk с восстановлением без потери нового документа.

## Форматы и фоновые задачи

`BackgroundTask` больше не импортирует `compute` статически в main. При отсутствии Worker загружается fallback; аргументы копируются до первого `await import()`, отмена проверяется после загрузки и между шагами. Ошибки работающего Worker не маскируются повторным запуском на main thread.

Worker bootstrap содержит операции сохранения/валидации и общую модель документа, но не экспорт и кодеки. `ExportPreparation` загружается для операции export. GIF, APNG, ICO/CUR, ZIP и Aseprite загружаются внутри выбранной операции в worker или fallback. В main Aseprite/GIF decoder и palette-file codec загружаются по расширению входного файла; кодек палитр отделён от списка presets. PNG/JPEG/WebP используют браузерные image APIs, `.pixprite` использует общее ядро сериализации/миграций, необходимое для restore. Отдельного JS-кодека PNG или отдельного сетевого entry для каждого из текстовых GPL/PAL/HEX/ACT здесь нет.

WebM recorder вынесен в собственный entry; запрос происходит при фактическом экспорте WebM. Выбор пункта в диалоге его не загружает. Browser test проверяет загрузку recorder, скачивание контейнера с EBML-заголовком и отсутствие запросов GIF/APNG/ICO. Существующий GIF E2E проверяет полный export/import с пикселями и timing; новый network test проверяет, что PNG export не запрашивает неиспользуемые кодеки, а GIF import запрашивает только decoder. Ошибки сетевой загрузки форматных модулей проходят через сообщения import/export/save; palette export фиксирует имя и палитру до ожидания модуля.

## Самостоятельные расширения

`extensions/ai-assistant` и `extensions/game-rig` — самостоятельные продукты на публичном `@pixprite/api`, а не модули редактора. Их исходники, manifest, locales и assets распространяются отдельным каталогом. Они не становятся зависимостями `src/index.tsx` и не копируются в editor `dist`.

Существующий `scripts/vite-extensions.js` работает только в dev. Production editor и каталог расширений выпускаются разными workflows: `.github/workflows/main.yml` и `.github/workflows/extensions.yml`. Каталог публикует собственные файлы с SHA-256 и commit-pinned package URLs; `public: false` исключает пакет из выпуска, сохраняя локальную проверку. Выгрузить только эти два пакета можно так:

```sh
bun scripts/build-extensions.ts --out /tmp/pixprite-extension-release ai-assistant game-rig
```

`extension-artifacts.test.ts` переносит только каталоги этих расширений и private template в отдельную временную директорию, повторно строит публичный каталог, проверяет оба независимых пакета, hashes и исключение template. Исходники расширений не менялись. Graph gate запрещает любой модуль из `extensions/` в main/worker bundle. Сами расширения можно вынести в другой репозиторий с сохранением публичного API и самостоятельного процесса выпуска; физическое перемещение репозиториев в этот блок не входит.

## Воспроизводимая проверка

```sh
bun run build
bun run bundle:check
bun run bundle:graph
PIXPRITE_E2E_PREBUILT=1 bun run test:e2e
```

Vite пишет `.vite/manifest.json`, `.vite/main-graph.json` и `.vite/worker-graph.json` в `dist`. Дополнительные graphs содержат относительные module IDs, состав chunks, static/dynamic edges; абсолютные пути машины не сохраняются. `bundle:graph` печатает JSON с gzip-суммами, списками файлов и сопоставлением demand entries. `bundle:check` включает этот gate, поэтому существующий CI проверяет границы после build.

Gate проверяет статические транзитивные графы initial, фактического Home bootstrap, editor UI и worker bootstrap. Он запрещает в них неподходящие редкие UI/кодеки, проверяет наличие настоящих dynamic entries в Vite manifest, сохранение ядра restore и отсутствие пересечений static/dynamic imports одних модулей внутри каждого графа сборки. Worker и browser — независимые entry graphs; их общие модули допустимы. E2E дополнительно наблюдает реальные production HTTP requests с заблокированным SW, чтобы кеш не скрывал лишние загрузки.

Измерение 2026-10-30 после bundle split и Service Worker, gzip level 9, байты JavaScript:

| Метрика | До (`e3d052b`) | После | Неизменённый budget |
| --- | ---: | ---: | ---: |
| Initial: HTML entry + static imports | 283092 | 183809 | 307200 |
| Весь emitted JS, включая workers | 394653 | 408109 | 409600 |
| Home bootstrap: initial + Home + запускаемый host/compiler | не измерялся отдельно | 276659 | — |
| Дополнительный editor UI относительно Home bootstrap | не измерялся отдельно | 57695 | — |

Initial уменьшился примерно на 35%. Суммарный gzip вырос примерно на 3.4%: отдельные chunks сжимаются независимо, demand exports собираются для main fallback и Worker, появились loading/error UI. Budget не повышен; до total budget остаётся 1491 байт. Статическая initial-метрика не выдаётся за полную сетевую стоимость первого экрана: дополнительный startup host явно учтён строкой Home bootstrap. JSON graph artifacts и precache manifest не являются JS и не входят в JS budgets; сам SW входит в total.

## Offline и обновления

Production SW теперь precache-ит полный build, включая все ленивые chunks, Worker imports и шрифты. После успешной установки и первого controlled открытия встроенные функции можно впервые вызвать offline. Precache не исполняет модули; graph/network E2E запускаются с заблокированным SW, сохраняя проверку demand loading. Тест ошибки offline/retry в этом наборе проверяет поведение загрузчика без SW.

Версионирование снимка, SHA-256 integrity, естественная активация после закрытия всех controlled вкладок, сохранность проектов, изоляция cache scope и граница первого HTTP-открытия описаны в [service-worker.md](service-worker.md). Отдельный production E2E использует два реальных HTML/assets snapshots, offline Worker/fallback и ошибочные deployments; прежнее ограничение «работают только ранее вызванные функции» устранено.
