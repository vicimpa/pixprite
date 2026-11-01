import { createElement, memo, useLayoutEffect, useRef, type FC } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import '@pixprite/ui/elements';
import type { PxIcon } from '@pixprite/ui/elements';
import { iconArtwork, resolveIconPack, selectedIconPack } from '~/core/IconPacks';
import { ICONS, type IconName } from './icons';

export type IconProps = { name: IconName; scale?: 'tool' | 'glyph' | number };
export const Icon: FC<IconProps> = memo(({ name, scale = 'tool' }) => {
  useSignals();
  const host = useRef<PxIcon>(null), pack = selectedIconPack.value;
  const artwork = iconArtwork(pack, name);
  useLayoutEffect(() => {
    const element = host.current!;
    element.pixels = ICONS[name] ?? ICONS.square;
    element.artwork = artwork ?? undefined;
    element.scale = scale;
  }, [name, artwork, scale]);
  return createElement('px-icon', { ref: host, name, pack: resolveIconPack(pack) });
});
