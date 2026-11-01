# @pixprite/ui-react

The editor-supplied React controls for sandboxed Pixprite panels and widgets.
Set a contribution's `page` to `widget.tsx` and default-export a component:

```tsx
import { useState } from 'react';
import { Button } from '@pixprite/ui-react';

export default () => {
  const [count, setCount] = useState(0);
  return <Button onClick={() => setCount(n => n + 1)}>{count}</Button>;
};
```

No HTML or separate build is needed. A page may accept `{ ctx }: ExtensionPageProps`
to use its connected API, role and contribution ID. All API permissions still apply.
`mountPage(Component, container?)` supports manual mounting in existing HTML pages.

Exports: `Button`, `Input`, `Check`, `Range`, `Label`, `Muted`, `Separator`, `Select`,
`mountPage` and their types. Controls use the same Web Components as the editor.
Import hooks from the host-supplied `react`; JSX uses its matching `react/jsx-runtime`.
React DOM is supplied inside the iframe and cannot access the parent document.

The package is a built-in extension import, not a dependency to download from npm.
See the [extension guide](../../docs/extensions/README.md#react-pages-tsx) and
[working template](../../extensions/template/src/widget.tsx).
