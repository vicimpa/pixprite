export type { Manifest, PixelData, Problem, FormSchema, FormValues, FormField, Permission } from "@pixprite/api";

/** One row of public/extensions/registry.json */
export type RegistryEntryLike = {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
  permissions?: string[];
  /** Folder of the extension, relative to the registry file */
  path: string;
  /** `sha256-<base64>` of manifest.json + files */
  integrity?: string;
  /** Language packs: translated share 0..100, per language code (older registries: one number) */
  completeness?: number | Record<string, number>;
  /** Name and description per language (the plain ones are English) */
  i18n?: Record<string, { name: string; description?: string; }>;
};

export type Registry = { extensions: RegistryEntryLike[]; } | RegistryEntryLike[];
