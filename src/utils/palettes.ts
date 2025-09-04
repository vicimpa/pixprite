import { Color } from "$core/Color";
import { parsePalette } from "./color";

const palettes = import.meta.glob<false, string, { default: string; }>(
  '../assets/palettes/**/*.gpl',
  { query: 'inline&raw' }
);

export const paletteCollection = await Promise.all(
  Object.entries(palettes)
    .map(async ([name, load]) => {
      name = name.replace('assets/palettes', '-');
      const names = name.split('/');
      const group = names.at(-2);
      name = names.at(-1) ?? 'Unknow name';

      var promise: Promise<Color[]> | null = null;

      async function fetch() {
        const data = await load();
        return parsePalette(data.default);
      }

      return {
        name,
        group,
        async fetch() {
          return promise ?? (
            promise = fetch()
          );
        }
      };
    }));