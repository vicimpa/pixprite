import { signal } from '@preact/signals-react';

export type ViewerTab = { id: string; name: string; image: string; width: number; height: number; items: { name: string; frame: number; revision: number; documentId: string; layer?: number }[] };
export const viewerTabs = signal<ViewerTab[]>([]);
export const activeViewer = signal<string | null>(null);
export function addViewer(tab: Omit<ViewerTab, 'id'>) {
  const viewer = { ...tab, id: crypto.randomUUID() };
  viewerTabs.value = [...viewerTabs.peek(), viewer];
  return viewer;
}
export function closeViewer(id = activeViewer.peek()) {
  viewerTabs.value = viewerTabs.peek().filter(tab => tab.id !== id);
  if (activeViewer.peek() === id) activeViewer.value = null;
}
