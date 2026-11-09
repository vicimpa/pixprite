import { state } from './State';
import { addImportedBrushes, itemFromBrush } from './Brushes';
import { blobToBitmap, download, pickFiles } from './Files';
import { bitmapToCanvas } from './Image';
import { decodeBrushFile, encodeBrushFile, MAX_BRUSH_FILE_BYTES } from './BrushFile';
import { t } from './i18n';

export async function importBrushes() {
  const files = await pickFiles('.pixbrush,application/json,image/png', true);
  if (!files.length) return;
  try {
    const items = [];
    let bytes = 0;
    for (const file of files) {
      bytes += file.size;
      if (bytes > MAX_BRUSH_FILE_BYTES) throw new Error('Brush files are too large');
      if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
        const bmp = await blobToBitmap(file);
        const item = itemFromBrush({ bmp, ox: 0, oy: 0, align: 'dab' }, file.name.replace(/\.png$/i, '') || t('brush.brush'));
        delete item.settings;
        items.push(item);
      } else items.push(...decodeBrushFile(await file.text()));
    }
    // Reuse the same validation for a batch and for PNG-derived resources.
    const valid = decodeBrushFile(encodeBrushFile(items));
    addImportedBrushes(valid);
    state.showTip(t('brush.imported', { count: valid.length }));
  } catch { state.showTip(t('brush.importFailed'), 5000); }
}

export function exportBrushes(library = false) {
  try {
    const name = state.customBrush?.stampId ? t(state.customBrush.stampId) : t('brush.brush');
    const items = library ? [...state.docBrushes, ...state.brushLibrary].filter(item => item.kind === 'brush')
      : state.customBrush ? [itemFromBrush(state.customBrush, name)] : [];
    if (!items.length) return;
    download(new Blob([encodeBrushFile(items)], { type: 'application/json' }), library ? 'Pixprite Brushes.pixbrush' : `${name}.pixbrush`);
  } catch { state.showTip(t('brush.exportFailed'), 5000); }
}

export async function exportBrushPng() {
  if (!state.customBrush) return;
  try {
    const blob = await bitmapToCanvas(state.customBrush.bmp).convertToBlob({ type: 'image/png' });
    download(blob, 'Brush.png');
  } catch { state.showTip(t('brush.exportFailed'), 5000); }
}
