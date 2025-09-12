import { Color } from "$core/Color";
import { Flex } from "$ui/Flex";
import { Panel } from "$ui/Panel";
import { prop, reactive } from "@vicimpa/decorators";
import { PickerHsv } from "./modules/PickerHsv";
import { PickerHsl } from "./modules/PickerHsl";
import { computed, effect } from "@preact/signals-react";
import { Reactive } from "$core/Reactive";
import { signalRef } from "$utils/signals";
import { useEffect } from "$utils/decorators";

export type ColorPickerProps = {
  onChange?: (color: Color, alt: boolean) => any;
};

export const PickerType = {
  hsv: (self: ColorPicker) => (
    <PickerHsv ref={self.hsv} onChange={self.$props.onChange} />
  ),
  hsl: (self: ColorPicker) => (
    <PickerHsl ref={self.hsl} onChange={self.$props.onChange} />
  )
};

export type PickerType = keyof typeof PickerType;

@reactive()
export class ColorPicker extends Reactive<ColorPickerProps> {
  @prop color = new Color();
  @prop type: PickerType = 'hsl';
  @prop hsv = signalRef<PickerHsv>(null);
  @prop hsl = signalRef<PickerHsl>(null);
  @prop get drag() { return Boolean(this.hsv.value?.drag || this.hsl.value?.drag); }

  pickerView = computed(() => PickerType[this.type](this));

  @useEffect()
  detectChange() {
    return effect(() => {
      this.hsv.value?.setColor(this.color);
      this.hsl.value?.setColor(this.color);
    });
  }

  setColor(color: Color) {
    this.color = color.clone();
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