# Pixel Composer — карта возможностей

Исследовано 9 ноября 2026 года. [Репозиторий](https://github.com/Ttanasart-pt/Pixel-Composer)
изучен на [main `d4d24687`](https://github.com/Ttanasart-pt/Pixel-Composer/commit/d4d2468706530082d57733776835593e2c107497)
от 8 ноября 2026. На странице автора разделены **stable 1.22.0.5** и
**beta 1.22.2**. Ниже подробные возможности подтверждены авторскими страницами
из текущего `main`; весь каталог не сверялся со stable. Приложение не запускалось.
[Страница автора](https://makham.itch.io/pixel-composer).

Центральный ориентир — процедурное изготовление пиксельных игровых ассетов
и VFX. Пользователь сохраняет рецепт, управляет его значениями и временем,
затем получает изображения, кадры и анимации.
[README на SHA](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/README.md).

## Семейства возможностей

Все ссылки на каталог ниже закреплены на исследованном SHA. Метка
«документировано в main» подтверждает описанный сценарий и не заменяет
ручную проверку конкретной сборки.

| Семейство | Что делает пользователь и зачем | Первичный источник |
| --- | --- | --- |
| Операции и соединения | Меняет свойства вручную, связывает их с другими выходами или анимирует; возвращается к рецепту | [Nodes basics](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/3_nodes/000_index.html) |
| Данные для управления графикой | Использует изображения, числа, векторы, палитры, кривые, пути, структуры и массивы; значения управляют формой и изображением | [Junctions](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/3_nodes/001_junctions.html) |
| Шумы и поля | Настраивает seed, детальность и пространственный Tile; Progress у Flow Noise управляет изменением поля | [Simplex](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_noise_simplex.md), [Flow Noise](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_flow_noise.md) |
| Формы и пути | Строит формы, соединяет/перераспределяет пути и рисует по ним | [Release notes 1.22](https://makham.itch.io/pixel-composer/devlog/1680231/122-full-release-note), [каталог страниц](https://github.com/Ttanasart-pt/Pixel-Composer/tree/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes) |
| Scatter | Размещает изображения по области, маске или пути; меняет угол, масштаб, цвет, сортировку и перенос через край | [Scatter](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_scatter.md) |
| Цвет и пиксельный стиль | Отображает яркость на градиент, ограничивает цвета, применяет RGB/alpha-дизеринг со своим паттерном | [Colorize](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_colorize.md), [Dither](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_dither.md) |
| Композиция | Смешивает поверхности с opacity/Preserve Alpha, собирает несколько изображений в результат заданных размеров | [Blend](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_blend.md), [Composite](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_composite.md) |
| Движение изображения | Трансформирует изображение, ведёт его по пути, поворачивает по направлению, создаёт echo; округляет координаты для пиксельного вывода | [Transform](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_transform.md) |
| Входные рисунки | Загружает изображения, последовательности и спрайтшиты; читает слои/теги Aseprite | [Image Sheet](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_image_sheet.md), [Ase File](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_ase_file_read.md): Aseprite tilemap этой нодой не поддержан |
| Частицы | Настраивает stream/burst/trigger, источник, жизнь, движение, цвет/масштаб/поворот и следы | [Particle](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_particle.md) |
| Готовые VFX | Использует высокоуровневые генераторы дождя, дымового пути и взрывной анимации | [Rain](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_mk_rain.md), [Smoke](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_mk_smoke.md), [Blast](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_mk_blast_inline.md) |
| Растительность | Генерирует стволы, листья, рост и траву с распределением, плотностью, вариацией цвета и sway | [Tree](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_mk_tree_root.md), [Grass](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_mk_grass.md) |
| Специальные симуляции | Работает с жидкостью, дымом, rigid body и Verlet в отдельных контекстах | [Fluid](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_FLIP_group_inline.md), [Verlet](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_verletSim_group_inline.md) |
| Preview и исследование | Просматривает выбранный выход, split comparison, повтор X/Y, onion skin, элементы массива и данные соединения | [Preview](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/2_interfaces/preview_panel.html) |

## Рецепт, варианты и готовый игровой файл

Группа имеет явные входы/выходы. Коллекция сохраняет выбранный набор узлов
для другого проекта и обмена. Preset сохраняет значения узла; общие параметры
проекта и глобальные переменные дают дополнительные способы управления.
Это разные уровни повторного использования.
[Groups](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_group.md),
[Collections](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/2_interfaces/collection_panel.html),
[Inspector](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/2_interfaces/inspector_panel.html).

Анимируемые входы получают ключи с Linear/Smooth/Hold, кривые и отдельные
дорожки осей; драйверы добавляют линейное, периодическое или seeded-Wiggle
изменение. Массивы позволяют обрабатывать наборы и комбинации вариантов.
[Animation](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/4_animations/0_index.html),
[Drivers](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/4_animations/driver.html),
[Array Processor](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/3_nodes/002_array_processor.html).

Render Sprite Sheet укладывает кадры/массив в лист; Export выводит изображения,
последовательности и анимации, задаёт диапазон/шаг/имена. Подготовленный проект
с Export node имеет отдельный headless-сценарий с параметрами запуска.
[Sprite Sheet](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_render_sprite_sheet.md),
[Export](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_export.md),
[CLI](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/99_misc/command_line.html).

## Три разных требования к повторению

| Требование | Что проверять |
| --- | --- |
| Пространственный tile | Края изображения стыкуются при повторении по X/Y |
| Повтор анимации | Timeline возвращается к началу; наличие Loop само по себе не гарантирует незаметный переход |
| Временная бесшовность | Последний и первый кадры визуально продолжают движение/изменение без скачка |

Документация различает Hold/Loop/Pingpong/Wrap. У Particle есть специальный
loop с предварительным прогоном симуляции и предупреждением о стоимости.
Обычные соединения запрещают циклы; Feedback отдельно передаёт результат
следующему кадру. Эти ограничения не определяют будущую вычислительную
модель Pixprite.
[Looping](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/4_animations/looping.html),
[Particle](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_particle.md),
[Feedback](https://github.com/Ttanasart-pt/Pixel-Composer/blob/d4d2468706530082d57733776835593e2c107497/docsdata/content/__nodes/node_feedback_inline.md).

## Кандидаты для Pixprite и открытые вопросы

Основной кандидат — управляемая текстура: seed, размер деталей, палитра,
предпросмотр повторения, сохранение рецепта, применение к слою, ручная правка,
PNG. Дополнительный — один проверенный цикл воды. Далее полезны эффекты
из нарисованной искры/листа, распределение декора и растительность.
Это продуктовые предложения; способ реализации остаётся открытым.

Не проверены: идентичность seed между версиями/платформами, произвольная
бесшовность симуляции, автономная упаковка любых внешних зависимостей,
полнота метаданных экспорта для каждого движка и доступность кодеков на каждой ОС.
Release notes 1.22 сообщают об отдельной загрузке FFmpeg; наличие формата в
списке не означает одинаковую поставку на всех системах.
[Release notes](https://makham.itch.io/pixel-composer/devlog/1680231/122-full-release-note).

[Реестр](README.md) · [План 0.0.10](../releases/v0.0.10-plan.md) ·
[Подробные исследовательские заметки](<../../research_notes/Референсы возможностей Pixprite к 0010/pixel-composer.md>)
