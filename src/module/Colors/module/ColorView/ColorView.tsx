import { Flex } from "$ui/Flex";
import { Panel } from "$ui/Panel";
import { useComputed, useSignals } from "@preact/signals-react/runtime";
import * as styled from "./styled";
import type { Color } from "$core/Color";
import type { FC } from "react";
import rsp from "@vicimpa/rsp";
import { Variables } from "$ui/Variables";
import { Grid } from "$ui/Grid";

export type ColorViewProps = {
  color: Color;
};

export const ColorView: FC<ColorViewProps> = ({ color }) => {
  const colorString = useComputed(() => color.toHexString(true));

  return (
    <styled.ColorBox $grow>
      <Flex $inset $content="center" $items="center">
        <Grid inset />
        <Variables bg2={colorString}>
          <Panel />
        </Variables>
        <styled.ColorText>
          HI
        </styled.ColorText>
      </Flex>
    </styled.ColorBox>
  );
};