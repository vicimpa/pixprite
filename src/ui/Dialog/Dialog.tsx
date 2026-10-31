import { t } from "~/core/i18n";
import { Button } from "~/ui/Button";
import { Icon } from "~/ui/Icon";
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, type FC, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { trackPointer } from "~/ui/trackPointer";
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
    if (!el || e.button !== 0) return;
    const r = el.getBoundingClientRect();
    let x = r.left, y = r.top;
    el.style.willChange = 'transform';
    trackPointer(e, (dx, dy) => {
      x = Math.max(0, Math.min(innerWidth - 40, r.left + dx));
      y = Math.max(0, Math.min(innerHeight - 20, r.top + dy));
      el.style.transform = `translate3d(${x - r.left}px, ${y - r.top}px, 0)`;
    }, () => {
      Object.assign(el.style, { position: 'fixed', left: `${x}px`, top: `${y}px`, margin: '0', transform: '', willChange: '' });
    });
  };

  return (
    <styled.Window
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-wide={!!width && width > 560}
      style={{ width }}
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
