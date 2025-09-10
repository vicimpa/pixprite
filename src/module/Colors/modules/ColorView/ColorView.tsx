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
      <Panel>
        <Grid inset />
        <Variables color={colorString}>
          <styled.ColorView />
        </Variables>
        <Flex $inset $content="center" $items="center">
          <styled.ColorText>
            HI
          </styled.ColorText>
        </Flex>
      </Panel>
    </styled.ColorBox>
  );
};