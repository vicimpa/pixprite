import { Flex } from "$ui/Flex";
import { Panel } from "$ui/Panel";
import { useComputed, useSignals } from "@preact/signals-react/runtime";
import * as styled from "./styled";
import type { Color } from "$core/Color";
import type { FC } from "react";
import { Variables } from "$ui/Variables";
import { Grid } from "$ui/Grid";

export type ColorViewProps = {
  color: Color;
  index?: number;
};

export const ColorView: FC<ColorViewProps> = ({ color, index = -1 }) => {

  return (
    <styled.ColorBox $grow>
      <Panel>
        <Grid inset />
        <Variables color={color.toHexString(true)}>
          <styled.ColorView />
        </Variables>
        <Flex $inset $content="center" $items="center">
          <styled.ColorText>
            {
              index === -1 ? (
                color.toHexString(color.rgba[3] !== 1)
              ) : `IDS ${index}`
            }
          </styled.ColorText>
        </Flex>
      </Panel>
    </styled.ColorBox>
  );
};