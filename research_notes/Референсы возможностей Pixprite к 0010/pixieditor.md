# PixiEditor как продуктовый референс Pixprite

## 1. Какой срез изучен и что считается готовой функцией

### Takeaway
PixiEditor полезен прежде всего как пример непрерывного перехода между ручной графикой, недеструктивной композицией и настраиваемыми процедурными инструментами. Продуктовую картину следует брать из выпущенной 2.1 и актуальных handbook, а каталог master считать дополнительным свидетельством наличия функций в исходниках, не доказательством их качества во всех сборках.

### Cited Findings
- Исследование выполнено 9 ноября 2026 года. Локальный shallow clone: `.tmp/references/PixiEditor`; master зафиксирован на `b88021e0cdf9883e0c8627c9bec6ee03377c7e82`, дата коммита `2026-11-02T14:14:00+01:00`, сообщение `Init fixes (#1801)`. Это срез исходников, а не утверждение о последнем опубликованном patch-релизе. — [Зафиксированный коммит](https://github.com/PixiEditor/PixiEditor/commit/b88021e0cdf9883e0c8627c9bec6ee03377c7e82).
- Главная страница обозначает 2.1 как выпущенную: Brush Engine, Smart Layers, Customizable Toolsets и Brush Tools. Для 2.2 указан этап предложений. Среди открытых предложений перечислены PSD, бесконечный холст и indexed color; их нельзя включать в список уже доступных возможностей. — [Текущий сайт и roadmap](https://pixieditor.net/).
- Выпуск 2.1 датирован 30 апреля 2026 года; выпуск 2.0 — 30 июля 2025 года. В 2.0 заявлены растровая, векторная, покадровая и процедурная работа в одном приложении. — [2.1 release](https://pixieditor.net/blog/2026/04/30/21-release/), [2.0 release](https://pixieditor.net/blog/2025/07/30/20-release/).
- README описывает Pixel art, Painting и Vector toolsets, которые можно смешивать на одном холсте; там же keyframe-анимация векторов остаётся roadmap. README говорит преимущественно о 2.0 и не является полным каталогом обновлений 2.1. — [README на исследованном SHA](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/README.md).

### Inferences
- Для Pixprite стоит заимствовать продуктовую связность: художник может сначала получить обычный рисунок, затем управляемый результат и варианты, сохраняя возможность вернуться к исходнику. Это не требует утверждать, что все документы Pixprite должны повторять внутреннюю организацию PixiEditor.
- «Есть в каталоге нод», «документировано» и «проверено нами в работающем приложении» — три разных уровня. В этом исследовании выполнены первые два; приложение и чужие сборки не запускались, зависимости не устанавливались.

### Gaps
- Не устанавливалась точная последняя опубликованная patch-версия 2.1 на всех каналах распространения; зафиксированы release-линия, документация и SHA.
- Не проводилась ручная приёмка UX, скорости, совместимости файлов и аппаратного пера.

## 2. Ручное рисование, пиксели, вектор и недеструктивная композиция

### Takeaway
Базовый ручной редактор и ноды у PixiEditor образуют общий рабочий процесс. Наиболее интересны сохранение редактируемого вектора/текста, маски и возможность применить к ручному слою изменяемый эффект.

### Cited Findings
- Pixel art toolset включает pixel-perfect рисование; Painting — мягкие кисти и сглаженные формы; Vector — формы и пути. Растр и вектор разрешено комбинировать в одном файле. — [README](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/README.md).
- Векторные слои редактируемы после создания; объявлены Bézier-пути/многоугольники, линии, эллипсы, прямоугольники и текст. Векторы можно отображать чёткими поверх low-resolution изображения. — [2.0: vector tools](https://pixieditor.net/blog/2025/07/30/20-release/).
- Маска управляет видимостью изображения через светлоту: чёрное скрывает, белое сохраняет, серые значения дают промежуточную непрозрачность. Маску добавляют в Layers и редактируют отдельно от изображения. — [Masking](https://pixieditor.net/docs/handbook/layers/masking/).
- У узлов слоёв и папок есть отдельные варианты изображения с фильтрами/без них, режим смешивания, непрозрачность, видимость и маска; это видно также для вложенного документа. — [Nested Document properties](https://pixieditor.net/docs/handbook/node-graph/nodes/structure/nested-document/), [слои и папки в каталоге](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes).
- Официальный первый урок подключает Shadow Filter к слою, после чего обычное рисование сразу отображается с тенью. — [Your First Graph](https://pixieditor.net/docs/handbook/node-graph/tutorials/your-first-graph/).

| Семейство | Наблюдаемая функция | Пользовательская ценность и пример для игровой графики (наш вывод) | Основание |
| --- | --- | --- | --- |
| Ручной пиксельный рисунок | Специализированный toolset с pixel-perfect режимом | Контроль каждого пикселя в исходном спрайте перед процедурными изменениями | [README](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/README.md) |
| Растровое рисование | Painting toolset, мягкие кисти и сглаженные формы | Референсы, большие текстуры, промежуточные маски | [README](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/README.md) |
| Редактируемые формы | Векторные слои, пути и текст | Силуэты и UI-элементы с последующей пиксельной растеризацией | [2.0 release](https://pixieditor.net/blog/2025/07/30/20-release/) |
| Маски слоёв | Отдельный управляющий видимостью рисунок | Локальная область воды, огня, износа или перекраски без стирания оригинала | [Masking](https://pixieditor.net/docs/handbook/layers/masking/) |
| Живые фильтры | Фильтр подключён к ручному слою | Контур/тень автоматически следует за изменяемым спрайтом | [Your First Graph](https://pixieditor.net/docs/handbook/node-graph/tutorials/your-first-graph/) |

### Inferences
- Для раннего Pixprite наиболее заметен небольшой набор живых операций над уже нарисованным слоем. Обязательное требование к такому сценарию: изменение исходника обновляет результат без повторного ручного запуска всей цепочки.
- Редактируемый текст и полноценные векторные объекты — самостоятельное расширение продукта; их не следует считать обязательной предпосылкой первого процедурного сценария.

### Gaps
- Произвольное сочетание эффектов при экспорте в SVG не проверено; поддержка отдельных SVG-фильтров не означает полного SVG round-trip.
- Точная семантика масок групп, clipping и порядка нескольких фильтров требует отдельной приёмки примерами.

## 3. Какие семейства операций и данных даёт граф

### Takeaway
Граф охватывает изображения, формы, цвет, числа и время, а также интерфейсные входы и несколько выходов. Важно изучать не общее количество нод, а пользовательские действия, которые из них получаются.

### Cited Findings
- Каждый документ имеет свой граф; слои представлены нодами, а Output показывает итог композиции. Доступны дополнительные выходы для разных viewport. — [Getting Started with Nodes](https://pixieditor.net/docs/handbook/node-graph/getting-started-with-node-graph/).
- Входы и выходы типизированы; неподключённый вход может редактироваться вручную. Документация различает Painter, Texture, Filter, числа/векторы, цвет, Paintable, строки, геометрию, матрицы, Document Reference, Palette и массивы. — [Property Sockets](https://pixieditor.net/docs/handbook/node-graph/property-sockets/).
- Noise поддерживает Perlin, Turbulence и Voronoi; настраиваются offset, scale, octaves, seed, параметры Voronoi. Одинаковый seed позволяет повторить рисунок. — [Noise](https://pixieditor.net/docs/handbook/node-graph/nodes/image/noise/).
- Pattern размещает изображение вдоль формы: предусмотрены шаг, выравнивание внутри/снаружи/по центру и размещение без деформации либо растяжение. — [Pattern](https://pixieditor.net/docs/handbook/node-graph/nodes/image/pattern/).

| Семейство | Подтверждённые ноды / операции | Зачем пользователю (наш вывод) | Прямое свидетельство |
| --- | --- | --- | --- |
| Структура композиции | Image Layer, Vector Layer, Folder, Nested Document, Output | Соединять ручной источник, вложенный ассет и результат | [каталог Structure и базовых нод](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes) |
| Генерация изображения | Noise, Create Image | Основа текстуры/маски с управляемыми вариациями | [Noise](https://pixieditor.net/docs/handbook/node-graph/nodes/image/noise/), [CreateImageNode](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/CreateImageNode.cs) |
| Изображение и композиция | Merge, Mask, Tile, Sample Image | Смешивание, ограничение области, повтор текстуры | [MaskNode](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Image/MaskNode.cs), [TileNode](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/TileNode.cs) |
| Стиль и фильтры | Outline; Blur, Shadow, Grayscale, Color Adjustments, Color Matrix, Invert, Sepia, Kernel | Живое оформление спрайта и коррекция | [OutlineNode](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Effects/OutlineNode.cs), [каталог фильтров](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/FilterNodes) |
| Ограничение цвета | Color Map, Color Ramp, Posterization | Согласовать результат с художественной палитрой | [Color Map](https://pixieditor.net/docs/handbook/node-graph/nodes/image/color-map/), [ColorRampNode](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/ColorRampNode.cs), [PosterizationNode](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Effects/PosterizationNode.cs) |
| Цвет и градиенты | Palette, Decompose Palette, Gradient, Decompose Gradient, Color, Lerp, Combine/Separate Color | Варианты одного ассета и управление цветовыми диапазонами | [каталог нод](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes), [Paintables](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Paintables) |
| Каналы | Combine Channels, Separate Channels | Собрать несколько одноканальных карт в один RGB-ресурс | [Channel Packing](https://pixieditor.net/docs/handbook/node-graph/tutorials/channel-packing/) |
| Преобразования | Offset, Scale, Rotate, Skew, Transform, Compose/Decompose Matrix | Положение, размер, ориентация результата | [Matrix](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Matrix) |
| Формы и точки | Line, Rectangle, Ellipse, Pixel Perfect Ellipse, Bool Operation, Distribute Points, Evaluate Path, Remove Close Points, Rasterize Shape | Строить и преобразовывать силуэты, работать с размещением вдоль пути | [Shapes](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Shapes) |
| Текст | Text, Text On Path, Slice Text, Text Info, Text Index Of | Лейблы, титры, параметризуемые надписи | [Shapes/Text nodes](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Text) |
| Числа и логика | Math, Vector Math, Angle, Distance, Remap; Random, Switch, Equals | Связать пользовательские настройки и вариации | [Calculations](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Calculations), [Utility](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Utility) |
| Массивы | Array Converter, Array Element, Array Length | Несколько значений в одном параметре, в том числе градиенты | [Arrays](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Arrays) |
| Время | Time, Easing | Процедурная анимация с предсказуемым временем | [Procedural Animations](https://pixieditor.net/docs/handbook/animating/procedural/) |
| Контекст и инструменты | Pointer Info, Keyboard Info, Stroke Info, Editor Info, Document Info | Кисть/инструмент зависит от пера, документа и штриха | [Brushes nodes](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Brushes), [Editor](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/Editor) |
| Повторное использование | Blackboard Variable Value, Nested Document, Expose Value | Граф как настраиваемый ассет для других документов | [Expose Value](https://pixieditor.net/docs/handbook/node-graph/nodes/workspace/expose-value/) |
| Представление результата | Custom Output, Viewport Info | Разные preview и экспортируемые представления одного источника | [Custom Workspaces](https://pixieditor.net/docs/handbook/node-graph/custom-workspaces/) |
| Шейдерные операции | Shader, Begin/End Modify Image | Пользовательские визуальные операции как отдельное расширение возможностей | [каталог нод](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes) |

### Inferences
- Для планирования Pixprite следует описать ограниченный набор полезных операций и сквозной результат, а не обещать весь каталог. Возможности формы/точек/поля/пикселей можно обсуждать независимо от конкретного представления данных и вычислительного стека.
- Понятная ошибка несовместимого соединения и ручное редактирование неподключённого параметра — продуктовые требования к удобству, даже если будущий интерфейс Pixprite будет иным.

### Gaps
- Наличие математических и массивных нод не доказывает наличие произвольных циклов, записываемых переменных и событий. В 2.1 они обсуждаются в смешанном списке готового и планируемого; подтверждены каталогом только явно названные выше операции.
- Не проверены все комбинации типов/неявных преобразований и точное ограничение вычислений каждого узла.

## 4. Smart Layers, исходники, внешние параметры и повторное применение

### Takeaway
Ключевая пользовательская возможность — сохранить сложную работу как редактируемый вложенный документ и использовать её с разными параметрами в другой композиции. Важно различать входные параметры, выходные значения и сам пиксельный результат.

### Cited Findings
- Nested Document предназначен для включения `.pixi` в другой документ и повторного использования контента. Он имеет собственные настройки смешивания, маски, фильтров, clipping и nearest-neighbour/bilinear sampling. — [Nested Document](https://pixieditor.net/docs/handbook/node-graph/nodes/structure/nested-document/).
- Вложенному документу можно передавать собственный active frame или normalized time вместо общего времени; это позволяет независимо управлять фазой экземпляра анимации. — [Nested Document: custom time](https://pixieditor.net/docs/handbook/node-graph/nodes/structure/nested-document/).
- Blackboard задаёт константы и входы графа. При включении документа как Smart Layer открытые переменные автоматически становятся входами узла; отдельные переменные можно скрыть из внешнего интерфейса. Типы включают числа, размеры, векторы, текст, font family, boolean, цвет, текстуру, документ и геометрию. — [Blackboard](https://pixieditor.net/docs/handbook/node-graph/blackboard/).
- Expose Value создаёт именованный выход для использования снаружи вложенного графа; это позволяет передавать не только финальное изображение. Документация прямо называет `.pixi` средством повторного использования графов между документами. — [Expose Value](https://pixieditor.net/docs/handbook/node-graph/nodes/workspace/expose-value/).
- Примеры авторов 2.1: дерево используется шесть раз; анимация текста получает текстовую строку из родительского документа. — [Smart Layers в выпуске 2.1](https://pixieditor.net/blog/2026/04/30/21-release/).
- В исходниках существуют превращение обычного слоя/участника композиции в Smart Layer и Unlink. UI вложенного слоя различает внешнюю связь и ссылку на внутренний ресурс, показывает состояние ссылки, умеет Relink; данные вложенного документа хранятся отдельно от его пути. — [LayersViewModel](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/ViewModels/SubViewModels/LayersViewModel.cs), [NestedDocumentNodeViewModel](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/ViewModels/Document/Nodes/NestedDocumentNodeViewModel.cs), [DocumentReference](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/DocumentReference.cs).
- Состав входов вложенного узла соответствует открытым переменным Blackboard, выходов — Expose Value; это подтверждено исходником узла, а не только иллюстрацией интерфейса. — [NestedDocumentNode](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/NestedDocumentNode.cs).

### Inferences
- Продуктовое требование для Pixprite: «Сохранил настройку/граф, повторно открыл, применил к другому исходнику, изменил параметры, получил новый результат» должно быть отдельным приёмочным сценарием.
- Ещё более сильное развитие: несколько экземпляров одного ассета получают общие исправления источника, сохраняя собственные положения/параметры. Это пользовательское поведение; не нужно заранее выбирать linked/embedded модель ресурсов, формат сериализации или схему пересчёта.
- Простого экспорта PNG недостаточно для повторного использования: нужны сохранённые входы и возможность открыть редактируемый исходник.

### Gaps
- Не проверено в приложении, когда именно обновляются экземпляры после редактирования/сохранения исходника и как различается поведение внешних файлов и embedded-ресурсов.
- Не подтверждена политика автообновления внешнего файла с диска, конфликтов, missing-file fallback и распространения изменений между несколькими открытыми документами. Исходники показывают UI Relink/Unlink, но не доказывают всю end-to-end семантику.
- Не проверена упаковка зависимостей при отправке чужого `.pixi`; не обещать автономность любого внешне связанного документа без отдельного теста.

## 5. Кисти как настраиваемые инструменты

### Takeaway
Brush Engine интересен не количеством готовых кистей, а тем, что граф может стать обычным инструментом с понятными настройками. Художнику не обязательно каждый раз открывать граф.

### Cited Findings
- Кисти выбираются в Pen/Eraser; доступны превью штриха, поиск и теги. Источники кистей различаются: Built-in, Local, Opened Document, Extension; встроенную кисть можно дублировать в локальную копию. — [Getting Started with Brushes](https://pixieditor.net/docs/handbook/brushes/getting-started/).
- Базовая кисть задаёт геометрическую область, содержимое, размер/позиционирование и шаг штампов. Учебный пример создаётся в отдельном документе и появляется в выборе кисти; затем к нему подключают данные нажима. — [Creating custom brushes — Basic](https://pixieditor.net/docs/handbook/brushes/creating-brushes/).
- Продвинутые кисти читают содержимое холста и изменяют его. Официальный пример кисти переводит область в grayscale; для фильтров с соседними пикселями предусмотрена расширенная область sampling, чтобы уменьшать краевые артефакты. Параметры Blackboard выводятся в панель инструмента; не у всех типов есть готовый редактор toolbar. — [Creating custom brushes — Advanced](https://pixieditor.net/docs/handbook/brushes/advanced-brush/).
- В 2.1 описаны time-based и distance-based стабилизаторы, sub-pixel рисование с опциональным pixel snapping, настройка шага/поворота/scattering; brush tools позволяют делать самостоятельные инструменты. — [Brush Engine 2.1](https://pixieditor.net/blog/2026/04/30/21-release/).
- В репозитории представлены готовые графовые кисти и brush tools: среди файлов есть PixelSquare, PixelCircle, Texture, Foam, Splats, Smudge, Gradient и инструменты Blur, Sharpen, BackgroundEraser, FindAndReplace. Это подтверждение примеров в master, не проведённая нами оценка их качества. — [Brushes](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Data/Brushes), [BrushTools](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Data/BrushTools).

### Inferences
- Полезное продолжение после 0.0.8: заданные художником параметры кисти, шаг/разброс/повторяемый seed и сохранение результата в библиотеке. Но полноценная графовая система кистей не обязана входить в 0.0.10.
- Возможность применять эффект кистью по области — отдельный выразительный сценарий, который связывает ручное действие и процедурную обработку.

### Gaps
- Совместимость кистей с каждым типом слоя, особенности смешивания и реальное перо не проверялись.
- Не установлены практические пределы размера/сложности кисти и latency.

## 6. Анимация и связь с ручными кадрами

### Takeaway
Покадровый рисунок и анимация вычисляемых параметров могут использоваться совместно. Это даёт сильный мост от одного нарисованного ассета к готовой игровой анимации.

### Cited Findings
- Timeline поддерживает покадровые cels и процедурную анимацию одновременно; доступны FPS, onion skin, создание/дублирование/удаление cels, изменение продолжительности и положения cel, сворачивание строки слоя и отключение анимации слоя. — [Getting Started with Animations](https://pixieditor.net/docs/handbook/animating/getting-started/).
- Time предоставляет active frame и normalized time; Easing позволяет изменять характер перехода. Официальные примеры связывают время с непрозрачностью, масштабом и поворотом изображения. — [Intro to Procedural Animations](https://pixieditor.net/docs/handbook/animating/procedural/).
- Вложенная анимация может получать независимое время из родителя. — [Nested Document: custom time](https://pixieditor.net/docs/handbook/node-graph/nodes/structure/nested-document/).
- README перечисляет экспорт GIF/MP4, а PNG exporter различает spritesheet и animated PNG; документация 2.1 объявляет импорт GIF/APNG в кадры. — [README](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/README.md), [PngFileType](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Models/Files/PngFileType.cs), [2.1 release](https://pixieditor.net/blog/2026/04/30/21-release/).
- Keyframe-анимация векторов не подтверждена как готовая: README относит её к roadmap; в предложениях после 2.1 обсуждается Key Frame Animations. — [README](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/README.md), [What's next 2.1](https://pixieditor.net/blog/2026/04/30/21-release/).

### Inferences
- Приёмка сильного первого сценария Pixprite: нарисованный спрайт или маска, несколько изменяемых во времени параметров, предпросмотр, диапазон кадров, экспорт spritesheet/GIF и сохранение редактируемого проекта.
- Простое изменение offset/цвета/непрозрачности по времени может дать заметную новую пользу без обещания полноценного keyframe-редактора.

### Gaps
- Не проверены точность loop seam, соответствие FPS/длительностей при экспорте и совместимость всех эффектов с форматом анимации.
- Не найдена достаточная база, чтобы объявить готовыми универсальную риговую, скелетную или полноценную векторную keyframe-анимацию.

## 7. Цвет, палитры, эффекты и игровой обмен файлами

### Takeaway
PixiEditor совмещает обычную работу с палитрой с процедурной коррекцией и несколькими форматами вывода. Для Pixprite особенно полезна возможность получить согласованные варианты ассета и экспортировать именно нужный выход.

### Cited Findings
- Цветовая система включает основные/фоновые цвета, HEX/RGBA, HSV/HSL/RGB, пипетку слоя или композиции, историю swatches и палитры. Библиотека палитр имеет поиск/сортировку/фильтр числа цветов/избранное; есть извлечение палитры из PNG и импорт Lospec. Замена цвета затрагивает палитру и соответствующие пиксели. — [Working with Colors](https://pixieditor.net/docs/handbook/essentials/managing-color/).
- Color Map перекладывает изображение на заданную палитру; документация указывает выбор унаследованного, sRGB либо linear sRGB пространства. — [Color Map](https://pixieditor.net/docs/handbook/node-graph/nodes/image/color-map/).
- Каналы нескольких grayscale-карт можно объединить в один RGB-ресурс, а затем разобрать на именованные Custom Outputs. — [Channel Packing tutorial](https://pixieditor.net/docs/handbook/node-graph/tutorials/channel-packing/).
- В текущем каталоге форматов присутствуют `.pixi`, PNG, JPEG, BMP, WebP, SVG, GIF, MP4 и чтение TTF/OTF. У TTF/OTF явно отключено сохранение; редактирование открытого шрифтового рисунка не равно экспорту шрифта. — [каталог Files](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Models/Files), [TtfFileType](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Models/Files/TtfFileType.cs), [OtfFileType](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Models/Files/OtfFileType.cs).
- `.pixi` сохраняет редактируемый документ; экспорт видео использует выбранный output и размер, а PNG имеет отдельные пути spritesheet/анимации. — [PixiFileType](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Models/Files/PixiFileType.cs), [VideoFileType](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Models/Files/VideoFileType.cs), [PngFileType](https://github.com/PixiEditor/PixiEditor/blob/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Models/Files/PngFileType.cs).

### Inferences
- Полезно планировать раздельно: редактируемый проект/настройка, итоговые пиксели и игровой экспорт. Это три разных результата для пользователя.
- Для 0.0.10 быстрый выбор палитры/цветового варианта генератора даст больше заметной пользы, чем поддержка большого количества новых файловых форматов.

### Gaps
- Полный round-trip SVG и возможность сохранять все графовые эффекты без растрирования не подтверждены.
- Поддержка Aseprite, PSD и indexed-document pipeline не установлена как выпущенная возможность. PSD/Indexed Color на текущем сайте находятся среди предложений, а не в подтверждённом списке.

## 8. Какие готовые сквозные workflows особенно важны

### Takeaway
Самая сильная демонстрация — короткий понятный путь от ручного исходника к нескольким полезным результатам, с изменяемыми параметрами и возможностью вернуться к источнику. Ниже реальные официальные примеры отделены от предложений для Pixprite.

### Cited Findings
1. **Ручной рисунок с живой обработкой.** Урок подключает тень к обычному слою, после чего новые штрихи отображаются с эффектом. Исходник продолжает редактироваться привычным инструментом. — [Your First Graph](https://pixieditor.net/docs/handbook/node-graph/tutorials/your-first-graph/).
2. **Повторяемый ассет с входами.** Авторы демонстрируют повторное использование дерева и текстового animation template; Blackboard даёт внешние параметры, Expose Value — выходы. — [2.1 Smart Layers](https://pixieditor.net/blog/2026/04/30/21-release/), [Blackboard](https://pixieditor.net/docs/handbook/node-graph/blackboard/), [Expose Value](https://pixieditor.net/docs/handbook/node-graph/nodes/workspace/expose-value/).
3. **Ручная текстура и прикладной preview.** Официальный cube workspace показывает исходную развёртку и 3D-превью одного документа; Custom Output задаёт отдельные размер, предпросмотр и экспорт. Готовый cube workspace в уроке отнесён к Founder’s Pack. — [Custom Workspaces](https://pixieditor.net/docs/handbook/node-graph/custom-workspaces/).
4. В репозитории есть наборы примеров с названиями FirePixel, Island, SeamlessNoise, TextAnimation, Tree, Pond и др. Наличие файлов подтверждено, визуальная корректность и поставка каждого из них в конкретном релизе нами не проверены. — [BetaExampleFiles на исследованном SHA](https://github.com/PixiEditor/PixiEditor/tree/b88021e0cdf9883e0c8627c9bec6ee03377c7e82/src/PixiEditor/Data/BetaExampleFiles).
5. В 2.1 описаны прикладные extension-workspaces: tiled/cube texturing, normal maps с источником света и skybox. Это отдельные наборы/расширения, их нельзя автоматически считать встроенными бесплатными инструментами любой поставки. — [2.1 Extension Browser](https://pixieditor.net/blog/2026/04/30/21-release/).

### Inferences
- **Предпочтительный небольшой WOW-сценарий к 0.0.10: параметризуемая пиксельная текстура.** Пользователь выбирает пример, меняет seed/масштаб/палитру, видит результат, ограничивает его ручной маской/областью, применяет к существующему слою, дорисовывает, отменяет/повторяет, сохраняет настройку и экспортирует PNG. Основание — комбинация подтверждённых Noise, Color Map, Mask и workspaces; это наше предложение, не утверждение о готовой идентичной кнопке PixiEditor. — [Noise](https://pixieditor.net/docs/handbook/node-graph/nodes/image/noise/), [Color Map](https://pixieditor.net/docs/handbook/node-graph/nodes/image/color-map/), [Masking](https://pixieditor.net/docs/handbook/layers/masking/).
- **Если есть ресурс на анимацию:** добавить время к такому примеру или ручному спрайту, получить короткий управляемый эффект и spritesheet. Критерий — законченный экспортируемый результат, а не максимальное число операций. — [Procedural Animations](https://pixieditor.net/docs/handbook/animating/procedural/).
- **Следующий сильный сценарий:** один нарисованный ассет становится настраиваемым ресурсом для нескольких вариантов; изменение исходника обновляет экземпляры. Сохранение/повторное открытие/повторное применение важнее первого количества шаблонов. — [Nested Document](https://pixieditor.net/docs/handbook/node-graph/nodes/structure/nested-document/), [Expose Value](https://pixieditor.net/docs/handbook/node-graph/nodes/workspace/expose-value/).
- Для itch.io стоит показать три коротких демонстрации: готовый пример → изменение параметров; применение к ручному рисунку → дорисовка; сохранение/повторное использование → игровой экспорт. Это предложение о презентации Pixprite, а не исследованный маркетинговый результат.
- Не следует ставить к 0.0.10 обязательное повторение универсального редактора, 3D preview, шейдерный язык, графовые кисти, все форматы или все ноды. Реализацию, стек, вычислительную модель, хранение графов и устройство интерфейса выбираем позже по отдельному проектированию.

### Gaps
- Это продуктовые кандидаты, без оценки сроков и архитектурной реализуемости в Pixprite. Приоритет должен быть сопоставлен с текущей моделью проекта, что делает отдельное исследование команды.
- Не подтверждена аудитория/конверсия itch.io для конкретного сценария; формулировка «WOW» здесь означает наглядный законченный результат для демонстрации, а не обещание коммерческого успеха.
