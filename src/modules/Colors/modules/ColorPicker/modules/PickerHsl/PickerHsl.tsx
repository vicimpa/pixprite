import { Flex } from "$ui/Flex";
import { Grid } from "$ui/Grid";
import { Panel } from "$ui/Panel";
import { Slider } from "$ui/Slider";
import { useSignalRef } from "$utils/signals";
import { useMemo, type FC } from "react";

import { Color } from "$core/Color";
import { useComputed } from "@preact/signals-react";
import { Gradient } from "$ui/Gradient/Gradient";

export type PickerHslProps = {
  color?: Color;
  onChange?: (color: Color, alt: boolean) => any;
};

export const PickerHsl: FC<PickerHslProps> = ({ color, onChange }) => {
  const current = useMemo(() => color?.clone() ?? Color.fromHsv(180, .5, .5, .5), [color]);
  const hlRef = useSignalRef<Slider>(null);
  const satRef = useSignalRef<Slider>(null);
  const alphaRef = useSignalRef<Slider>(null);

  const hlGradient = useComputed(() => {
    var [, s] = current.hsl;
    return ({
      a: [0, s, 0, 1],
      b: [1, s, 0, 1],
      c: [0, s, 1, 1],
      d: [1, s, 1, 1],
    });
  });

  const satGradient = useComputed(() => {
    var [h, , l] = current.hsl;
    h /= 360;
    return ({
      ac: [h, 0, l, 1],
      bd: [h, 1, l, 1],
    });
  });

  const alphaGradient = useComputed(() => {
    var [h, s, l] = current.hsl;
    h /= 360;

    return ({
      ac: [h, s, l, 0],
      bd: [h, s, l, 1],
    });
  });

  return (
    <>
      <Flex $grow>
        <Panel>
          {/* HL Slider */}
          <Grid inset />
          <Gradient inset hsl gradient={hlGradient} />
        </Panel>
        <Slider
          ref={hlRef}
          onChange={({ x, y }, alt) => {
            const [, s, , a] = current.hsla;
            current.setFromHsl(x * 360, s, 1 - y, a);
            onChange?.(current.clone(), alt);
          }} />
      </Flex>
      <Flex $basis={32}>
        <Panel>
          {/* Sat Slider */}
          <Grid inset />
          <Gradient inset hsl gradient={satGradient} />
        </Panel>
        <Slider
          ref={satRef}
          freezeY
          onChange={({ x, y }, alt) => {
            const [h, , l, a] = current.hsla;
            current.setFromHsl(h, x, l, a);
            onChange?.(current.clone(), alt);
          }} />
      </Flex>
      <Flex $basis={32}>
        <Panel>
          {/* Alpha Slider */}
          <Grid inset />
          <Gradient inset hsl gradient={alphaGradient} />
          <Slider
            ref={alphaRef}
            freezeY
            onChange={({ x, y }, alt) => {
              const [h, s, l] = current.hsla;
              current.setFromHsl(h, s, l, x);
              onChange?.(current.clone(), alt);
            }} />
        </Panel>
      </Flex>
    </>
  );
};