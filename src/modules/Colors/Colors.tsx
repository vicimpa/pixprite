import { Color } from "$core/Color";
import { Flex } from "$ui/Flex";
import { Panel } from "$ui/Panel";
import { prop, reactive } from "@vicimpa/decorators";
import { provide } from "@vicimpa/react-decorators";
import { Component } from "react";
import { ColorList } from "./modules/ColorList";
import { signalRef } from "$utils/signals";
import { ColorPicker } from "./modules/ColorPicker";
import { ColorView } from "./modules/ColorView";
import * as styled from "./styled";
import { Resizer } from "$ui/Resizer";

@reactive()
@provide()
export class Colors extends Component {
  list = signalRef<ColorList>();
  picker = signalRef<ColorPicker>();

  colorA = Color.fromHex('#000');
  colorB = Color.fromHex('#ffffff');

  render() {
    return (
      <Flex $inset $column>
        <Flex $basis={32}>
          {/* Color params */}
        </Flex>
        <Flex $grow>
          <Flex $inset $column>
            <Flex $grow>
              <ColorList ref={this.list} />
            </Flex>
            <Flex $column $basis={256}>
              <ColorPicker ref={this.picker} />
              <Resizer start />
            </Flex>
          </Flex>
        </Flex>
        <styled.FlexWrap $gap={4} $items="stretch">
          <ColorView color={this.colorA} />
          <ColorView color={this.colorB} />
        </styled.FlexWrap>
      </Flex>
    );
  }
}