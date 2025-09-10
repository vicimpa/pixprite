import { Color } from "$core/Color";
import { Flex } from "$ui/Flex";
import { Panel } from "$ui/Panel";
import { Component } from "react";
import { prop, reactive } from "@vicimpa/decorators";
import { PickerHsv } from "./modules/PickerHsv";
import { PickerHsl } from "./modules/PickerHsl";

export type ColorPickerProps = {
  type?: 'hsv' | 'hsl';
};

@reactive()
export class ColorPicker extends Component<ColorPickerProps> {
  color = new Color();

  @prop get h() {
    return this.color.hsv[0];
  }

  @prop get s() {
    return this.color.hsl[1];
  }

  render() {
    return (
      <Panel>
        <Flex $inset $column $gap={0}>
          <PickerHsv />
          {/* <PickerHsl /> */}
        </Flex>
      </Panel>
    );
  }
}