import { Color } from "$core/Color";
import { Flex } from "$ui/Flex";
import { prop, reactive, real } from "@vicimpa/decorators";
import { provide } from "@vicimpa/react-decorators";
import { Component } from "react";
import { ColorList } from "./modules/ColorList";
import { signalRef } from "$utils/signals";
import { ColorPicker } from "./modules/ColorPicker";
import { ColorView } from "./modules/ColorView";
import * as styled from "./styled";
import { Resizer } from "$ui/Resizer";
import { useEffect } from "$utils/decorators";
import { batch, effect } from "@preact/signals-react";
import rsp from "@vicimpa/rsp";
import { dispose } from "$utils/common";

@reactive()
@provide()
export class Colors extends Component {
  list = signalRef<ColorList>();
  picker = signalRef<ColorPicker>();

  @prop colorA = Color.fromHex('#6c1b1b');
  @prop colorB = Color.fromHex('#ffffff');
  @prop pickerAlt = false;

  get current() {
    return this.pickerAlt ? this.colorB : this.colorA;
  }

  set current(v) {
    this[this.pickerAlt ? 'colorB' : 'colorA'] = v;
  }

  @useEffect()
  detectPicker() {
    return dispose(
      effect(() => {
        this.picker.value?.setColor(this.current);
      })
    );
  }

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
              <ColorPicker
                ref={this.picker}
                onChange={(color, alt) => {
                  batch(() => {
                    this.pickerAlt = alt;
                    this.current = color;
                  });
                }} />
              <Resizer start />
            </Flex>
          </Flex>
        </Flex>
        <styled.FlexWrap $gap={4} $items="stretch">
          <rsp.$ $target={ColorView} color={real(this, 'colorA')} />
          <rsp.$ $target={ColorView} color={real(this, 'colorB')} />
        </styled.FlexWrap>
      </Flex>
    );
  }
}