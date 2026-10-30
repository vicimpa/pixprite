/** DOM-free content-addressed resources shared by compute Worker and fallback. */
export type StoredDocument = { storage: 'pixprite-resources-v1'; document: any; resources: string[] };
export type Resource = { shape: string; payload: string };
export type ResourceBundle = { manifest: unknown; payloads: Map<string, Resource> };
export const isManifest = (data: any): data is StoredDocument => data?.storage === 'pixprite-resources-v1';

/** Content keys also protect independent imported documents with identical image IDs. */
async function resourceKey(payload: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return key;
}

const resourceShape = (owner: any, field: string) => field === 't' ? `tiles:${owner.tc}:${owner.tr}`
  : 'tw' in owner ? `tileset:${owner.tw}:${owner.th}:${owner.count}` : `image:${owner.w}:${owner.h}`;

function resourceFields(document: any) {
  const fields: [any, string][] = [];
  for (const image of document?.images ?? []) fields.push([image, 'd']);
  for (const tileset of document?.tilesets ?? []) fields.push([tileset, 'd']);
  for (const layer of document?.layers ?? []) for (const cel of layer.cels ?? []) {
    if (cel && !('link' in cel)) {
      if ('d' in cel) fields.push([cel, 'd']); // lazy v3/v4 compatibility
      if ('t' in cel) fields.push([cel, 't']);
    }
  }
  return fields;
}

export async function splitDocument(data: any): Promise<ResourceBundle> {
  const document = structuredClone(data), payloads = new Map<string, Resource>();
  const fields = resourceFields(document);
  await Promise.all(fields.map(async ([owner, field]) => {
    const payload = owner[field];
    if (typeof payload !== 'string') return;
    const shape = resourceShape(owner, field);
    const key = await resourceKey(`${shape}:${payload}`);
    payloads.set(key, { shape, payload });
    owner[field] = { $resource: key };
  }));
  return { manifest: { storage: 'pixprite-resources-v1', document, resources: [...payloads.keys()] } satisfies StoredDocument, payloads };
}

/** Validate content addresses before publishing a reconstructed document. Runs in Worker. */
export async function hydrateDocument(data: StoredDocument, entries: [string, Resource][]) {
  const payloads = new Map(entries);
  const document = structuredClone(data.document);
  for (const [owner, field] of resourceFields(document)) {
    const key = owner[field]?.$resource;
    if (typeof key !== 'string' || !payloads.has(key)) throw new Error('Invalid document resource reference');
    const resource = payloads.get(key)!;
    if (resource.shape !== resourceShape(owner, field) || await resourceKey(`${resource.shape}:${resource.payload}`) !== key)
      throw new Error(`Damaged document resource: ${key}`);
    owner[field] = resource.payload;
  }
  return document;
}
