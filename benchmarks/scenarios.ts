export type Scenario = { id: string; width: number; height: number; frames: number; layers: number; linked?: boolean; tiles?: number };
export const fullScenarios: Scenario[] = [
  ...[100, 400, 1000].map(frames => ({ id: `frames-${frames}`, width: 32, height: 32, frames, layers: 1 })),
  ...[10, 50, 100].map(layers => ({ id: `layers-${layers}`, width: 128, height: 128, frames: 1, layers })),
  { id: 'image-2048', width: 2048, height: 2048, frames: 1, layers: 1 },
  { id: 'image-wide-4096', width: 4096, height: 256, frames: 1, layers: 1 },
  { id: 'linked-50000', width: 32, height: 32, frames: 1000, layers: 50, linked: true },
  { id: 'tileset-4096', width: 256, height: 256, frames: 1, layers: 1, tiles: 4096 },
];
export const drawingScenario: Scenario = { id: 'long-stroke', width: 256, height: 256, frames: 1, layers: 1 };
export const autosaveScenario: Scenario = { id: 'drawing-autosave', width: 1024, height: 1024, frames: 1, layers: 4 };

