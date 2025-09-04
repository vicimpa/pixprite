import type { FC } from "react";
import type { Color } from "../../core/Color";
import { GridView } from "../ui/GridView";
import { Flex } from "../ui/Flex";

export type ColorInfoProps = {
  color: Color;
  prefix?: string;
  suffix?: string;
};

export const ColorInfo: FC<ColorInfoProps> = ({ color, prefix, suffix }) => {
  const { r, g, b } = color.toRgb();
  const hex = color.toHex();
  const style = {
    backgroundColor: color.toCssRgb()
  };

  return (
    <Flex inline>
      <i className="i-eyedropper" />
      <GridView className="border-1 border-gray-300 w-8 h-4">
        <div className="w-full h-full" style={style} />
      </GridView>
      {prefix}{' '}
      (RGB {r} {g} {b}){' '}
      {hex}{' '}
      {color.a !== 1 ? `A${color.a * 255 | 0} ` : ''}
      {suffix}
    </Flex>
  );
};