/**
 * Installable app: the service worker (production only, so dev reloads stay fresh) and files
 * the system hands over — opened with Pixprite from the file manager when the app is installed
 * (manifest `file_handlers`, Chromium) and delivered here through the launch queue.
 */

import { loadFiles } from "~/core/Files";

type LaunchParams = { files: FileSystemFileHandle[]; };
type LaunchQueue = { setConsumer(fn: (params: LaunchParams) => void): void; };

/**
 * Desktop only: the editor needs a mouse or pen and a large screen, so phones and tablets are not offered the install.
 * Judged by the device, not the window size, so a narrow desktop window still counts.
 * iPads report a Mac user agent, hence the touch-only check.
 */
export const isDesktop = () => !/Android|iPhone|iPad|Mobile/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && !matchMedia('(any-pointer: fine)').matches);

export function installPwa(ready: Promise<unknown>) {
  if (!isDesktop()) return;
  // The manifest is linked from here, not from index.html, so mobile browsers never see it
  const link = Object.assign(document.createElement('link'), { rel: 'manifest', href: './manifest.webmanifest' });
  document.head.append(link);

  if (import.meta.env.PROD && 'serviceWorker' in navigator)
    addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch(err => console.error('Service worker failed', err)));

  const queue = (window as { launchQueue?: LaunchQueue; }).launchQueue;
  queue?.setConsumer(async ({ files }) => {
    if (!files?.length) return;
    // The editor state and texts must be in place before documents open
    await ready;
    await loadFiles(await Promise.all(files.map(h => h.getFile())));
  });
}
