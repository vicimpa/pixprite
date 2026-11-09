/** Browser-generated resize delivery diagnostics have no JavaScript exception. */
export function isResizeDeliveryNotification(event: Pick<ErrorEvent, 'isTrusted' | 'error' | 'message' | 'filename' | 'lineno' | 'colno'>) {
  return event.isTrusted && event.error == null && !event.filename && !event.lineno && !event.colno
    && event.message === 'ResizeObserver loop completed with undelivered notifications.';
}
