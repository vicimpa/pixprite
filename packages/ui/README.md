# @pixprite/ui

The shared Web Components used by Pixprite and its sandboxed extension panels. Browser code has no React or editor-state dependency. The editor provides the installed UI version to extensions.

```ts
import '@pixprite/ui/elements';

const select = document.createElement('px-select');
select.innerHTML = '<option value="a">First</option><option value="b">Second</option>';
select.value = 'a';
select.addEventListener('change', () => console.log(select.value));
document.body.append(select);
```

`@pixprite/ui` and `@pixprite/ui/elements` export/register the same classes. `@pixprite/ui/legacy` exports the native-HTML compatibility adapter. The editor's React primitive adapters are available from `@pixprite/ui/react`; editor-specific adapters resolve translations, signals, document choices and palettes before passing them to the shared elements.

During development, changing this package reloads the editor page so each document registers the updated constructors. Production sandbox sources are transpiled and minified at build time.

| Group | Elements |
| --- | --- |
| Native controls | `px-button`, `px-input`, `px-checkbox`, `px-range`, `px-select` |
| Composite controls | `px-color-input`, `px-menu`, `px-menu-bar`, `px-dialog`, `px-form`, `px-slider`, `px-splitter`, `px-resizer` |
| Layout | `px-label`, `px-muted`, `px-separator`, `px-flex`, `px-grid`, `px-panel`, `px-head` |
| Measured content | `px-adaptive-bar`, `px-floating-panel`, `px-virtual-list` |
| Presentation | `px-icon`, `px-canvas`, `px-grid-pattern`, `px-shader`, `px-gradient`, `px-variables`, `px-tooltip` |

Native controls use light DOM and retain their native children, names, form association and events. Existing inputs can be supplied directly:

```html
<label for="amount">Amount</label>
<px-input>
  <input id="amount" name="amount" type="number" min="1" max="64" value="8">
</px-input>
```

Use host properties for controlled updates. Values changed directly on an adopted native select require its `input`/`change` event or `host.refresh()` to update the visible trigger. Theme colors and metrics come from CSS custom properties; control styles are installed once in each document under the existing inline-style CSP.

`px-form` receives resolved `schema`, `values`, `palette` and `inline` properties. Its `valuechange` event carries the complete typed values in `event.detail`. Layers, tags, localized labels and other application data are supplied by the consumer.

`px-canvas` accepts `draw`/`loop` callbacks and owns resize/animation cleanup. `px-icon` accepts pixel or inert SVG-path artwork. `px-shader` accepts a GLSL `mainFrag` implementation and uniform values; `px-gradient` supplies HSV/HSL corner interpolation with a Canvas fallback.

See [extension usage](../../docs/extensions/README.md#shared-ui-components) and the [migration requirements and acceptance evidence](../../docs/ui-web-components.md).
