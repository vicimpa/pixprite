import type { FC } from "react";
import type { Color } from "../core/Color";
import { GridView } from "./GridView";

export type ColorInfoProps = {
  color: Color;
  isHSL?: boolean;
  i?: number;
  h?: number;
  s?: number;
  vl?: number;
  a?: number;
};

export const ColorInfo: FC<ColorInfoProps> = ({ color, isHSL, i, h, s, vl, a }) => {
  const { r, g, b } = color.toRgb();
  const hex = color.toHex();

  if (isHSL) {
    const hsl = color.toHsl();
    h = h ?? hsl.h;
    s = s ?? hsl.s;
    vl = vl ?? hsl.l;
  } else {
    const hsv = color.toHsv();
    h = h ?? hsv.h;
    s = s ?? hsv.s;
    vl = vl ?? hsv.v;
  }

  let format = `` +
    `${isHSL ? 'HSL' : 'HSV'} ` +
    `${h | 0}° ` +
    `${s * 100 | 0}% ` +
    `${vl * 100 | 0}%`;

  if (i !== undefined)
    format = `Index ${i}`;

  return (
    <>
      <b>{' '}</b>
      <GridView $size={8} className="inline-block w-4 h-2 border-1 border-gray-300">
        <div className="w-full h-full" style={{ backgroundColor: color.toCssRgb() }} />
      </GridView>
      {' '}
      {format}{' '}
      (RGB {r} {g} {b}){' '}
      {hex}{' '}
      {a === undefined ? '' : 'A' + color.toAlphaByte()}
    </>
  );
};