import { useEffect, useRef, useState, type FC } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import styled from 'styled-components';
import { Color } from '~/core/Color';
import { state } from '~/core/State';
import { t } from '~/core/i18n';
import { FloatingPanel } from '~/ui/AdaptiveBar/FloatingPanel';
import { Button, Muted } from '~/ui/Button';
import { ColorSliders } from '../ColorSliders';

const Content = styled.div`
  width: 280px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  & header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  & px-button, & button { max-width: 100%; }
  & button { white-space: normal; }
  & .px-ui-muted { white-space: normal; overflow-wrap: anywhere; min-width: 0; }
`;

type ScreenPicker = new () => { open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }> };

export const ColorPopup: FC<{ alt: boolean; anchor: HTMLButtonElement; onClose: () => void; }> = ({ alt, anchor, onClose }) => {
  useSignals();
  const color = alt ? state.colorB : state.colorA;
  const native = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [picking, setPicking] = useState(false);
  const [failed, setFailed] = useState(false);
  const ScreenPicker = (window as Window & { EyeDropper?: ScreenPicker }).EyeDropper;
  const nativePick = window.pixpriteDesktop?.pickScreenColor;
  const canPick = !!nativePick || (!!ScreenPicker && window.isSecureContext);
  const label = alt ? t('colors.editSecondary') : t('colors.editPrimary');
  const set = (hex: string) => {
    setFailed(false);
    const next = Color.fromHex(hex);
    // System pickers return RGB. Keep the independently editable alpha.
    next.rgba = [...next.rgb, (alt ? state.colorB : state.colorA).rgba[3]];
    if (alt) state.colorB = next; else state.colorA = next;
  };
  useEffect(() => () => controller.current?.abort(), []);
  const close = () => { onClose(); anchor.focus({ preventScroll: true }); };

  const pick = async () => {
    if (!canPick || controller.current) return;
    const pending = new AbortController();
    controller.current = pending;
    setPicking(true); setFailed(false);
    try {
      const hex = nativePick
        ? await nativePick({ signal: pending.signal })
        : (await new ScreenPicker!().open({ signal: pending.signal })).sRGBHex;
      if (hex && !pending.signal.aborted) set(hex);
    } catch (error) {
      if (!pending.signal.aborted && !(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
    } finally {
      controller.current = null;
      if (!pending.signal.aborted) setPicking(false);
    }
  };

  return <FloatingPanel anchor={anchor} open label={label} onClose={onClose}>
    <Content onKeyDownCapture={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    }} onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}>
      <header><strong>{label}</strong><Button type="button" onClick={close}>{t('common.close')}</Button></header>
      <ColorSliders alt={alt} compact />
      <input ref={native} type="color" hidden value={color.toHexString(false)} aria-label={t('colors.systemPicker')}
        onChange={e => set(e.target.value)} />
      <Button type="button" disabled={picking} onClick={() => {
        const input = native.current!;
        try {
          if (input.showPicker) input.showPicker(); else input.click();
        } catch { input.click(); }
      }}>{t('colors.systemPicker')}</Button>
      <Button type="button" disabled={!canPick || picking} title={!canPick ? t('colors.screenPickerUnavailable') : undefined}
        onClick={pick}>{t('colors.screenPicker')}</Button>
      {!canPick && <Muted>{t('colors.screenPickerUnavailable')}</Muted>}
      {picking && <Muted role="status">{t('colors.screenPickerActive')}</Muted>}
      {failed && <Muted role="status">{t('colors.screenPickerFailed')}</Muted>}
    </Content>
  </FloatingPanel>;
};
