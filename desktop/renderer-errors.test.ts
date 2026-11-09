import { expect, test } from 'bun:test';
import { isResizeDeliveryNotification } from './renderer-errors';

const notice = { isTrusted: true, error: null, message: 'ResizeObserver loop completed with undelivered notifications.', filename: '', lineno: 0, colno: 0 };
test('recognizes the browser resize delivery diagnostic without hiding script exceptions', () => {
  expect(isResizeDeliveryNotification(notice)).toBe(true);
  for (const change of [
    { isTrusted: false }, { error: new Error(notice.message) }, { error: notice.message },
    { filename: 'app.js' }, { lineno: 1 }, { colno: 1 }, { message: 'Script error.' },
  ]) expect(isResizeDeliveryNotification({ ...notice, ...change })).toBe(false);
});
