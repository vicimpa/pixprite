# PixiEditor — карта возможностей

Исследовано 9 ноября 2026 года. [Репозиторий](https://github.com/PixiEditor/PixiEditor)
изучен на [master `b88021e0`](https://github.com/PixiEditor/PixiEditor/commit/b88021e0cdf9883e0c8627c9bec6ee03377c7e82)
от 2 ноября 2026. Официальная линия **2.1 выпущена 30 апреля 2026**;
точная последняя patch-версия на всех каналах не устанавливалась.
Приложение не запускалось. Подтверждение документацией и исходниками
отделяется от ручной проверки. [Выпуск 2.1](https://pixieditor.net/blog/2026/04/30/21-release/).

Центральный продуктовый ориентир — один рисунок проходит путь от ручного
редактирования к изменяемой композиции, затем становится настраиваемым
повторно используемым ассетом. Визуальный граф связан с документом и его
слоями. [Введение в граф](https://pixieditor.net/docs/handbook/node-graph/getting-started-with-node-graph/).

## Семейства возможностей

| Семейство | Что делает пользователь | Польза для игровой графики | Подтверждение и зрелость |
| --- | --- | --- | --- |
| Pixel / Painting / Vector | Смешивает пиксельный рисунок, растровое рисование и редактируемые векторные формы в одном файле | Силуэт и детали создаются подходящими инструментами, затем используются вместе | [README на SHA](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/README.md), [выпуск 2.0](https://pixieditor.net/blog/2025/07/30/20-release/): выпущено |
| Формы и текст | Редактирует пути, Bézier-кривые, геометрические фигуры и текст после создания | UI, силуэты, надписи и последующая растеризация | [2.0](https://pixieditor.net/blog/2025/07/30/20-release/): выпущено; полный SVG round-trip не проверен |
| Маски | Рисует отдельную карту видимости с промежуточной прозрачностью | Износ, локальный эффект, ограничение текстуры без удаления оригинала | [Masking](https://pixieditor.net/docs/handbook/layers/masking/): документировано |
| Живые фильтры | Подключает обработку к слою и продолжает обычное рисование | Тень или оформление обновляется вслед за исходником | [Первый граф](https://pixieditor.net/docs/handbook/node-graph/tutorials/your-first-graph/): официальный сквозной урок |
| Шумы и повтор | Меняет seed, масштаб и детализацию шума; размещает изображение вдоль формы | Текстуры, маски, декор вдоль контура | [Noise](https://pixieditor.net/docs/handbook/node-graph/nodes/image/noise/), [Pattern](https://pixieditor.net/docs/handbook/node-graph/nodes/image/pattern/): документировано |
| Палитра и отображение цвета | Перекладывает изображение на палитру, управляет рампами и цветовыми вариантами | Общий стиль материала и вариантов спрайта | [Color Map](https://pixieditor.net/docs/handbook/node-graph/nodes/image/color-map/), [работа с цветом](https://pixieditor.net/docs/handbook/essentials/managing-color/): документировано |
| Геометрия, точки, преобразования | Создаёт формы, распределяет точки, растеризует, меняет положение и размер | Генерация силуэтов и размещение элементов до получения пикселей | [Shapes на SHA](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Shapes): main; отдельные узлы не прогонялись |
| Управляющие значения | Связывает цвет, число, текст, изображение, форму и другие значения с операциями | Понятные параметры вместо ручного повторения всей обработки | [Property Sockets](https://pixieditor.net/docs/handbook/node-graph/property-sockets/): документировано; это не выбранные типы будущего runtime Pixprite |
| Smart Layers | Использует редактируемый `.pixi` как вложенный документ с внешними параметрами | Одно дерево или шаблон надписи даёт несколько настраиваемых экземпляров | [2.1](https://pixieditor.net/blog/2026/04/30/21-release/), [Nested Document](https://pixieditor.net/docs/handbook/node-graph/nodes/structure/nested-document/): выпущено/документировано |
| Входы и выходы графа | Выставляет входы в Blackboard и именованные выходы через Expose Value | Передаёт параметры и использует граф в других документах | [Blackboard](https://pixieditor.net/docs/handbook/node-graph/blackboard/), [Expose Value](https://pixieditor.net/docs/handbook/node-graph/nodes/workspace/expose-value/): документировано |
| Несколько представлений | Настраивает дополнительные выходы, размеры, preview и экспорт | Один исходник даёт разные прикладные представления | [Custom Workspaces](https://pixieditor.net/docs/handbook/node-graph/custom-workspaces/): механизм документирован; готовые workspace-пакеты могут распространяться отдельно |
| Brush Engine | Выбирает/ищет/дублирует кисти; настраивает шаг, поворот, разброс и управление нажимом | Своя кисть становится удобным повторно используемым инструментом | [2.1](https://pixieditor.net/blog/2026/04/30/21-release/), [кисти](https://pixieditor.net/docs/handbook/brushes/getting-started/): выпущено/документировано |
| Графовые кисти и brush tools | Собирает содержимое/форму отпечатка, связывает параметры с пером, применяет обработку кистью по области | Процедурный инструмент доступен через привычный штрих | [базовая кисть](https://pixieditor.net/docs/handbook/brushes/creating-brushes/), [advanced brush](https://pixieditor.net/docs/handbook/brushes/advanced-brush/): официальные уроки |
| Ручная и процедурная анимация | Совмещает cels, onion skin и параметры, зависящие от кадра/нормализованного времени | Нарисованный ассет получает движение, масштаб, поворот или изменение alpha | [Timeline](https://pixieditor.net/docs/handbook/animating/getting-started/), [процедурная анимация](https://pixieditor.net/docs/handbook/animating/procedural/): документировано |
| Время вложенного ассета | Задаёт вложенной анимации собственный кадр или фазу | Несколько экземпляров воспроизводятся независимо | [Nested Document](https://pixieditor.net/docs/handbook/node-graph/nodes/structure/nested-document/): документировано |
| Прикладной вывод | Собирает каналы, выбирает нужный output, сохраняет редактируемый документ и растровые/анимационные результаты | Карты для игры, spritesheet, GIF/APNG/видео | [Channel Packing](https://pixieditor.net/docs/handbook/node-graph/tutorials/channel-packing/), [форматы на SHA](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Models/Files): документация и main; доступность каждого кодека не проверена |

## Три показательных сценария

**Ручной слой с живой тенью.** Пользователь подключает Shadow Filter и
продолжает рисовать; изображение уже показывается с обработкой. Это
официальный пример связи обычного редактора и графа.
[Урок](https://pixieditor.net/docs/handbook/node-graph/tutorials/your-first-graph/).

**Один редактируемый источник, несколько вариантов.** Smart Layers и
Blackboard позволяют использовать дерево несколько раз либо передавать
текст в шаблон анимированной надписи. Входы и именованные выходы делают
результат повторно используемым ресурсом.
[Примеры 2.1](https://pixieditor.net/blog/2026/04/30/21-release/),
[Expose Value](https://pixieditor.net/docs/handbook/node-graph/nodes/workspace/expose-value/).

**Текстура с прикладным preview.** Custom Workspace показывает развёртку
и куб, использующие один документ. Это референс нескольких представлений
и выходов; готовый cube workspace в уроке относится к Founder’s Pack.
[Custom Workspaces](https://pixieditor.net/docs/handbook/node-graph/custom-workspaces/).

## Что полезно для Pixprite и что ещё неизвестно

Первый кандидат — сохраняемый рецепт текстуры с seed, масштабом, палитрой,
предпросмотром и применением к обычным пикселям. Следующие возможности:
живая обработка ручного слоя, параметры кисти и несколько представлений
одного ассета. Это выводы для Pixprite, а не утверждённая архитектура.

PSD, infinite canvas и indexed color на исследованном сайте относятся к
предложениям; векторные keyframes указаны в roadmap. Их не считаем
выпущенным набором. Отдельные normal-map/voxel/cube workspaces не считаем
автоматически встроенными в каждую поставку.
[Сайт и предложения](https://pixieditor.net/),
[README](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/README.md).

Остаются непроверенными: автообновление внешних файлов, конфликты и missing-file
fallback; распространение правок между открытыми экземплярами; автономная
упаковка всех зависимостей; полный SVG round-trip; реальные пределы скорости
и работа пера. Документация подтверждает назначение Smart Layers, но эти
граничные сценарии требуют отдельной приёмки.

[Реестр](README.md) · [План 0.0.10](../releases/v0.0.10-plan.md) ·
[Подробные исследовательские заметки](<../../research_notes/Референсы возможностей Pixprite к 0010/pixieditor.md>)
