import { Flex } from "$ui/Flex";
import { Grid } from "$ui/Grid";
import { Panel } from "$ui/Panel";
import { Shader } from "$ui/Shader";

import gradientFrag from "./shader/gradient.frag";

export const PickerHsl = () => {
  return (
    <>
      <Flex $grow>
        <Panel>
          <Shader inset uniforms={{
            a: [0, 1, 0, 1],
            b: [1, 1, 0, 1],
            c: [0, 1, 1, 1],
            d: [1, 1, 1, 1],
          }} shader={gradientFrag} />
        </Panel>
      </Flex>
      <Flex $basis={32}>
        <Panel>
          <Shader inset uniforms={{
            a: [0, 0, .5, 1],
            b: [0, 1, .5, 1],
            c: [0, 0, .5, 1],
            d: [0, 1, .5, 1],
          }} shader={gradientFrag} />
        </Panel>
      </Flex>
      <Flex $basis={32}>
        <Panel>
          <Grid inset />
          <Shader inset uniforms={{
            a: [0, 1, .5, 0],
            b: [0, 1, .5, 1],
            c: [0, 1, .5, 0],
            d: [0, 1, .5, 1],
          }} shader={gradientFrag} />
        </Panel>
      </Flex>
    </>
  );
};