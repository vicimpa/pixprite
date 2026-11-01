import { useEffect, useState } from 'react';
import { Button, Muted, type ExtensionPageProps } from '@pixprite/ui-react';

export default function Panel({ ctx }: ExtensionPageProps) {
  if (!ctx.editorVersion) throw new Error('Requires Pixprite 0.0.4 or newer.');
  const [description, setDescription] = useState('');
  useEffect(() => {
    let active = true, request = 0;
    const refresh = async () => {
      const id = ++request, sprite = await ctx.sprite.get().catch(() => null);
      if (active && id === request) setDescription(sprite
        ? `${sprite.name}: ${sprite.width}×${sprite.height}, ${ctx.i18n.t('layers', { count: sprite.layers.length })}`
        : ctx.i18n.t('noSprite'));
    };
    const off = [ctx.events.on('sprite:change', refresh), ctx.documents.on('change', refresh), ctx.i18n.on('change', refresh)];
    void refresh();
    return () => { active = false; off.forEach(fn => fn()); };
  }, [ctx]);
  return <div style={{ padding: 8, display: 'grid', gap: 8 }}>
    <Muted style={{ whiteSpace: 'normal' }}>{description}</Muted>
    <Button type="button" onClick={() => ctx.commands.run(`${ctx.id}:hello`)}>{ctx.i18n.t('cmd.hello')}</Button>
  </div>;
}
