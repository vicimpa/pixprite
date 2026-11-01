import { useState } from 'react';
import { Button, type ExtensionPageProps } from '@pixprite/ui-react';

/** The editor mounts this default component and supplies the connected page context. */
export default ({ ctx }: ExtensionPageProps) => {
  const [count, setCount] = useState(0);
  const label = ctx.i18n.t('widget.clicks', { count });
  return (
    <Button $square aria-label={label} title={label} onClick={() => setCount(value => value + 1)}>
      {count}
    </Button>
  );
};
