import { t } from "~/core/i18n";
import { Button, Input } from "~/ui/Button";
import { useState, type FC } from "react";
import { Dialog, openDialog } from "./Dialog";

const Message = ({ text }: { text: string; }) => <div style={{ maxWidth: 380, whiteSpace: 'pre-line', lineHeight: 1.4 }}>{text}</div>;

/** Yes / no question in the app's own window; resolves true when confirmed. Texts are passed translated */
export function askConfirm(message: string, opts: { title?: string; ok?: string; cancel?: string; } = {}) {
  return new Promise<boolean>(resolve => {
    let answer = false;
    openDialog(close => (
      <Dialog title={opts.title ?? t('common.confirm')} submitLabel={opts.ok ?? t('common.ok')} cancelLabel={opts.cancel ?? t('common.cancel')}
        onSubmit={() => { answer = true; }}
        onClose={() => { close(); resolve(answer); }}>
        <Message text={message} />
      </Dialog>
    ));
  });
}

const TextAsk: FC<{ message: string; initial: string; title: string; ok: string; done: (v: string | null) => void; close: () => void; }> =
  ({ message, initial, title, ok, done, close }) => {
    const [value, setValue] = useState(initial);
    let submitted = false;
    return (
      <Dialog title={title} submitLabel={ok}
        onSubmit={() => { if (!value.trim()) return false; submitted = true; done(value.trim()); }}
        onClose={() => { close(); if (!submitted) done(null); }}>
        <Message text={message} />
        <Input value={value} autoFocus style={{ width: '100%', boxSizing: 'border-box', marginTop: 6 }}
          onFocus={e => e.currentTarget.select()} onChange={e => setValue(e.target.value)} />
      </Dialog>
    );
  };

/** Asks for a line of text; resolves null when cancelled */
export function askText(message: string, initial = '', opts: { title?: string; ok?: string; } = {}) {
  return new Promise<string | null>(resolve => {
    let settled = false;
    const done = (v: string | null) => { if (!settled) { settled = true; resolve(v); } };
    openDialog(close => <TextAsk message={message} initial={initial} title={opts.title ?? t('common.enterAValue')} ok={opts.ok ?? t('common.ok')} done={done} close={close} />);
  });
}

/** A message with a single button */
export function tell(message: string, title = 'Pixprite') {
  return new Promise<void>(resolve => {
    openDialog(close => (
      <Dialog title={title} submitLabel={t('common.ok')} cancelLabel={null} onSubmit={() => { }} onClose={() => { close(); resolve(); }}>
        <Message text={message} />
      </Dialog>
    ));
  });
}

/** A question with several answers; resolves the chosen index, or -1 when closed */
export function askChoice(message: string, answers: string[], opts: { title?: string; } = {}) {
  return new Promise<number>(resolve => {
    let picked = -1;
    openDialog(close => (
      <Dialog title={opts.title ?? t('common.confirm')} cancelLabel={null} onClose={() => { close(); resolve(picked); }}
        onSubmit={() => { picked = 0; }}
        extraButtons={answers.slice(1).map((a, i) => (
          <Button key={a} type="button" onClick={() => { picked = i + 1; close(); resolve(picked); }}>{a}</Button>
        ))}
        submitLabel={answers[0]}>
        <Message text={message} />
      </Dialog>
    ));
  });
}
