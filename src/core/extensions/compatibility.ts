import { version as editorVersion } from '../../../package.json';
import { compareVersions, isVersion } from './versions';
export { editorVersion };

/** Shared by installation, startup, pages and the catalog UI. Never trust catalog metadata alone. */
export function compatibilityError(manifest: { minEditorVersion?: string }, current = editorVersion): string | null {
  const minimum = manifest.minEditorVersion;
  if (minimum === undefined) return null;
  if (isVersion(minimum) && isVersion(current) && compareVersions(current, minimum) >= 0) return null;
  return `Requires Pixprite ${minimum} or newer (current: ${current || 'unknown'}). Update the editor to use this extension.`;
}

export function assertCompatible(manifest: { minEditorVersion?: string }) {
  const error = compatibilityError(manifest);
  if (error) throw new Error(error);
}
