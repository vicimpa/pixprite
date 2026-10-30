import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { t } from '~/core/i18n';
import { Button, Muted } from '~/ui/Button';
import { Dialog, openDialog } from '~/ui/Dialog';

/** A failed chunk request stays visible and can be retried after reconnecting. */
export class LazyFeature extends Component<{ load: () => Promise<{ default: ComponentType }>; children?: ReactNode }, { error: boolean; View: ComponentType }> {
  state = { error: false, View: lazy(this.props.load) };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return <div role="alert"><Muted>{t('msg.couldNotOpen')}</Muted> <Button onClick={() => this.setState({ error: false, View: lazy(this.props.load) })}>{t('common.retry')}</Button></div>;
    const View = this.state.View;
    return <Suspense fallback={<div role="status">{t('common.loading')}</div>}><View /></Suspense>;
  }
}

/** Preserve the synchronous close handle and modal keyboard guard while the code loads. */
export function lazyDialog<A extends unknown[]>(load: () => Promise<(...args: A) => (() => void) | void>) {
  return (...args: A) => {
    let cancelled = false;
    let closeActual: (() => void) | void;
    const close = () => { cancelled = true; closePending(); closeActual?.(); };
    let closePending = () => {};
    const attempt = () => {
      closePending();
      closePending = openDialog(() => <Dialog title={t('common.loading')} onClose={close} cancelLabel={t('common.cancel')}><span role="status">{t('common.loading')}</span></Dialog>);
      void load().then(open => {
        closePending();
        if (!cancelled) closeActual = open(...args);
      }).catch(error => {
        closePending();
        if (cancelled) return;
        console.error('Feature failed to load', error);
        closePending = openDialog(() => <Dialog title={t('msg.couldNotOpen')} onClose={close} cancelLabel={t('common.close')}><span role="alert">{String(error instanceof Error ? error.message : error)}</span><Button onClick={attempt}>{t('common.retry')}</Button></Dialog>);
      });
    };
    attempt();
    return close;
  };
}
