import { t } from "~/core/i18n";
import { Button } from "~/ui/Button";
import { Icon } from "~/ui/Icon";
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState, type FC, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as styled from "./styled";

type Entry = { id: number; render: (close: () => void) => ReactNode; };

const stack = signal<Entry[]>([]);

/** On macOS the close button sits on the left of the title bar, where Mac windows keep it */
export const closeLeft = /Mac/.test(navigator.platform);

/** The close button of dialog title bars, for other windows that should look the same */
export const CloseButton = styled.Close;
let nextId = 0;

/** Opens a modal window; `render` receives a function that closes it */
export function openDialog(render: (close: () => void) => ReactNode) {
  const id = nextId++;
  stack.value = [...stack.value, { id, render }];
  return () => { stack.value = stack.value.filter(e => e.id !== id); };
}

export const hasDialogs = () => stack.value.length > 0;

export const DialogHost: FC = () => {
  useSignals();
  return createPortal(
    <>
      {stack.value.map(entry => (
        <styled.Backdrop key={entry.id}>
          {entry.render(() => { stack.value = stack.value.filter(e => e.id !== entry.id); })}
        </styled.Backdrop>
      ))}
    </>,
    document.body
  );
};

export type DialogProps = {
  /** Texts are shown as is: callers pass translated text */
  title: string;
  onClose: () => void;
  /** Called on the primary button or Enter; return false to keep the dialog open */
  onSubmit?: () => void | boolean;
  submitLabel?: string;
  cancelLabel?: string | null;
  width?: number;
  children?: ReactNode;
  extraButtons?: ReactNode;
};

export const Dialog: FC<DialogProps> = ({
  title, onClose, onSubmit, submitLabel = t('common.ok'), cancelLabel = t('common.cancel'), width, children, extraButtons,
}) => {
  const [pos, setPos] = useState<{ x: number; y: number; } | null>(null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    addEventListener('keydown', onKey, true);
    // Focus the first field so typing works right away
    ref.current?.querySelector<HTMLInputElement>('input, select')?.focus();
    return () => removeEventListener('keydown', onKey, true);
  }, []);

  const dragTitle = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (e: PointerEvent) => setPos({
      x: Math.max(0, Math.min(innerWidth - 40, e.clientX - dx)),
      y: Math.max(0, Math.min(innerHeight - 20, e.clientY - dy)),
    });
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  return (
    <styled.Window
      ref={ref}
      data-wide={!!width && width > 560}
      style={{ width, ...(pos ? { position: 'fixed', left: pos.x, top: pos.y, margin: 0 } : {}) }}
      onKeyDown={e => e.stopPropagation()}
      onSubmit={e => {
        e.preventDefault();
        if (onSubmit?.() !== false) onClose();
      }}
    >
      <styled.TitleBar onPointerDown={dragTitle} data-close-left={closeLeft}>
        <span>{title}</span>
        <styled.Close type="button" onClick={onClose} onPointerDown={e => e.stopPropagation()}>
          <Icon name="close" scale="glyph" />
        </styled.Close>
      </styled.TitleBar>
      <styled.Body>{children}</styled.Body>
      <styled.Footer>
        {extraButtons}
        <span style={{ flexGrow: 1 }} />
        {onSubmit && <Button type="submit" $primary>{submitLabel}</Button>}
        {cancelLabel && <Button type="button" onClick={onClose}>{cancelLabel}</Button>}
      </styled.Footer>
    </styled.Window>
  );
};

export const Row = styled.Row;
export const FieldLabel = styled.FieldLabel;
export const Section = styled.Section;
