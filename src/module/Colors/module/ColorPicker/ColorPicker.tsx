import { Color } from "$core/Color";
import { Flex } from "$ui/Flex";
import { Panel } from "$ui/Panel";
import { Shader } from "$ui/Shader";
import { Component } from "react";

export class ColorPicker extends Component {
  color = new Color();

  render() {
    return (
      <Panel>
        <Flex $inset $column $gap={0}>
          <Flex $grow>
            <Panel>
              <Shader />
            </Panel>
          </Flex>
          <Flex $basis={32}>
            <Panel></Panel>
          </Flex>
          <Flex $basis={32}>
            <Panel></Panel>
          </Flex>
        </Flex>
      </Panel>
    );
  }
}