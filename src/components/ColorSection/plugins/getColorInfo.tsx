import { Color } from "../../../core/Color";
import { ColorInfo } from "../ColorInfo";

export const getColorInfo = (h: number, s: number, vl: number, a?: number, isHSL = false) => {
  const color = new Color();

  if (isHSL) {
    color.fromHsl(h, s, vl, a ?? 1);
  } else {
    color.fromHsv(h, s, vl, a);
  }

  return <ColorInfo color={color} prefix={`HS${isHSL ? 'L' : 'V'} ${h | 0}° ${s * 100 | 0}% ${vl * 100 | 0}%`} />;
};