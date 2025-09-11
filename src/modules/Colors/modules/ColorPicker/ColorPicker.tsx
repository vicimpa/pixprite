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
  @prop color = new Color();

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