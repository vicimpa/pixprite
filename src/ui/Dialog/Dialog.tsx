import { t } from "~/core/i18n";
import { Button } from "~/ui/Button";
import { Icon } from "~/ui/Icon";
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { createElement, useLayoutEffect, useRef, type FC, type ReactNode } from "react";
import "@pixprite/ui/elements";
import type { PxDialogElement } from "@pixprite/ui/elements";
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
  const ref = useRef<PxDialogElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    const submit = (event: Event) => { if (event.target === element && onSubmit?.() === false) event.preventDefault(); };
    const close = (event: Event) => { if (event.target === element) onClose(); };
    element.addEventListener('px-submit', submit); element.addEventListener('px-close', close);
    return () => { element.removeEventListener('px-submit', submit); element.removeEventListener('px-close', close); };
  }, [onSubmit, onClose]);

  return createElement('px-dialog', { ref, open: true, embedded: true, 'aria-label': title }, (
    <styled.Window
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-wide={!!width && width > 560}
      style={{ width }}
      onKeyDown={e => e.stopPropagation()}
    >
      <styled.TitleBar data-close-left={closeLeft}>
        <span>{title}</span>
        <styled.Close type="button" data-dialog-close onPointerDown={e => e.stopPropagation()}>
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
  ));
};

export const Row = styled.Row;
export const FieldLabel = styled.FieldLabel;
export const Section = styled.Section;
