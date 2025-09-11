import { Color } from "$core/Color";
import { Flex } from "$ui/Flex";
import { Panel } from "$ui/Panel";
import { prop, reactive } from "@vicimpa/decorators";
import { PickerHsv } from "./modules/PickerHsv";
import { PickerHsl } from "./modules/PickerHsl";
import { computed } from "@preact/signals-react";
import { Reactive } from "$core/Reactive";
import { signalRef } from "$utils/signals";

export type ColorPickerProps = {
  onChange?: (color: Color, alt: boolean) => any;
};

const PickerType = {
  hsv: (self: ColorPicker) => (
    <PickerHsv ref={self.hsv} onChange={self.$props.onChange} />
  ),
  hsl: (self: ColorPicker) => (
    <PickerHsl ref={self.hsl} onChange={self.$props.onChange} />
  )
};

type PickerType = keyof typeof PickerType;

@reactive()
export class ColorPicker extends Reactive<ColorPickerProps> {
  @prop color = new Color();
  @prop type: PickerType = 'hsv';
  @prop hsv = signalRef<PickerHsv>(null);
  @prop hsl = signalRef<PickerHsl>(null);
  @prop get drag() { return Boolean(this.hsv.value?.drag || this.hsl.value?.drag); }

  pickerView = computed(() => PickerType[this.type](this));

  setColor(color: Color) {
    this.color = color.clone();
    this.hsv.value?.setColor(color);
    this.hsl.value?.setColor(color);
  }

  render() {
    return (
      <Panel>
        <Flex $inset $column $gap={0}>
          {this.pickerView}
        </Flex>
      </Panel>
    );
  }
}