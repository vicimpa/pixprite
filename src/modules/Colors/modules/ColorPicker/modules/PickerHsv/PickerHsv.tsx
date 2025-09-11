import { Color } from "$core/Color";
import { Flex } from "$ui/Flex";
import { Grid } from "$ui/Grid";
import { Panel } from "$ui/Panel";
import { Slider } from "$ui/Slider";
import { useSignalRef } from "$utils/signals";
import { useEffect, useMemo, type FC } from "react";

import { useComputed, useSignalEffect } from "@preact/signals-react";
import { Gradient } from "$ui/Gradient/Gradient";

export type PickerHsvProps = {
  color?: Color;
  onChange?: (color: Color, alt: boolean) => any;
};

export const PickerHsv: FC<PickerHsvProps> = ({ color, onChange }) => {
  const current = useMemo(() => color?.clone() ?? Color.fromHsv(180, .5, .5, .5), [color]);
  const svRef = useSignalRef<Slider>(null);
  const hueRef = useSignalRef<Slider>(null);
  const alphaRef = useSignalRef<Slider>(null);

  const svGradient = useComputed(() => {
    var [h] = current.hsva;
    h /= 360;
    return ({
      a: [h, 0, 0, 1],
      b: [h, 1, 0, 1],
      c: [h, 0, 1, 1],
      d: [h, 1, 1, 1],
    });
  });

  const hueGradient = useComputed(() => {
    return ({
      a: [0, 1, 1, 1],
      b: [1, 1, 1, 1],
      c: [0, 1, 1, 1],
      d: [1, 1, 1, 1],
    });
  });

  const alphaGradient = useComputed(() => {
    var [h, s, v] = current.hsva;
    h /= 360;

    return ({
      a: [h, s, v, 0],
      b: [h, s, v, 1],
      c: [h, s, v, 0],
      d: [h, s, v, 1],
    });
  });

  const anyDrag = useComputed(() => {
    const { value: sv } = svRef;
    const { value: hue } = hueRef;
    const { value: alpha } = alphaRef;
    return Boolean(sv?.drag || hue?.drag || alpha?.drag);
  });

  useEffect(() => {
    const { value: sv } = svRef;
    const { value: hue } = hueRef;
    const { value: alpha } = alphaRef;

    if (!sv || !hue || !alpha) return;

    const [h, s, v, a] = current.hsva;
    sv.x = s;
    sv.y = 1 - v;
    hue.x = h / 360;
    alpha.x = a;
  }, [current]);

  useSignalEffect(() => {
    if (!anyDrag.value)
      return;

  });

  return (
    <>
      <Flex $grow>
        <Panel>
          {/* SV Slider */}
          <Grid inset />
          <Gradient inset gradient={svGradient} />
          <Slider
            ref={svRef}
            onChange={({ x, y }, alt) => {
              const [h, , , a] = current.hsva;
              current.setFromHsv(h, x, 1 - y, a);
              onChange?.(current.clone(), alt);
            }} />
        </Panel>
      </Flex>
      <Flex $basis={32}>
        <Panel>
          {/* Hue Slider */}
          <Grid inset />
          <Gradient inset gradient={hueGradient} />
          <Slider
            ref={hueRef}
            freezeY
            onChange={({ x }, alt) => {
              const [, s, v, a] = current.hsva;
              current.setFromHsv(x * 360, s, v, a);
              onChange?.(current.clone(), alt);
            }} />
        </Panel>
      </Flex>
      <Flex $basis={32}>
        <Panel>
          {/* Alpha Slider */}
          <Grid inset />
          <Gradient inset gradient={alphaGradient} />
          <Slider
            ref={alphaRef}
            freezeY
            onChange={({ x }, alt) => {
              const [h, s, v] = current.hsva;
              current.setFromHsv(h, s, v, x);
              onChange?.(current.clone(), alt);
            }} />
        </Panel>
      </Flex>
    </>
  );
};