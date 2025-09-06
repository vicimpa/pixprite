import type { FC } from "react";
import { Color } from "$core/Color";
import { GridView } from "$ui/GridView";
import { Flex } from "$ui/Flex";

export type ColorInfoProps = {
  color: Color;
  prefix?: string;
  suffix?: string;
};

export const ColorInfo: FC<ColorInfoProps> = ({ color, prefix, suffix }) => {
  const { r, g, b } = color.toRgb();
  const hex = color.toHex();
  const style = {
    width: 32,
    height: 16,
    backgroundColor: color.toCssRgb()
  };

  return (
    <Flex gap={8} items="center">
      <i className="i-eyedropper" />
      <GridView className="border-1 border-gray-300">
        <div style={style} />
      </GridView>
      {prefix}{' '}
      (RGB {r} {g} {b}){' '}
      {hex}{' '}
      {color.a !== 1 ? `A${color.a * 255 | 0} ` : ''}
      {suffix}
    </Flex>
  );
};

export const getColorInfo = (h: number, s: number, vl: number, a?: number, isHSL = false) => {
  const color = new Color();

  if (isHSL) {
    color.fromHsl(h, s, vl, a ?? 1);
  } else {
    color.fromHsv(h, s, vl, a);
  }

  return <ColorInfo color={color} prefix={`HS${isHSL ? 'L' : 'V'} ${h | 0}° ${s * 100 | 0}% ${vl * 100 | 0}%`} />;
};