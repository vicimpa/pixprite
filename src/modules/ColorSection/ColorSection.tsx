import { Component } from "react";
import { ColorList } from "./ColorList";
import { ColorPicker } from "./ColorPicker";
import { ColorView } from "./ColorView";
import { prop, reactive, real } from "@vicimpa/decorators";
import { Color } from "$core/Color";
import { batch } from "@preact/signals-react";
import { signalRef } from "$utils/signal";
import { connect, provide } from "@vicimpa/react-decorators";
import { Flex } from "$ui/Flex";
import detectChange from "./plugins/detectChange";
import { EditButton } from "./view/EditButton";
import { LoadButton } from "./view/LoadButton";
import { SettingsButton } from "./view/SettingsButton";
import { SortButton } from "./view/SortButton";
import { Panel } from "$ui/Panel";
import rsp from "@vicimpa/rsp";

@connect(detectChange)
@reactive()
@provide()
export class ColorSection extends Component {
  pickerRef = signalRef<ColorPicker>();
  listRef = signalRef<ColorList>();

  @prop inHSL = false;
  @prop edit = false;
  @prop colorA = new Color(255, 255, 0, 1);
  @prop colorB = new Color(125, 0, 255);
  @prop picker = 0;

  @prop get indexA() { return this.listRef.value?.indexA ?? -1; }
  @prop get indexB() { return this.listRef.value?.indexB ?? -1; }

  render() {
    return (
      <Flex column inset>
        <Flex size={32} gap={4}>
          <EditButton />
          <i />
          <SortButton />
          <LoadButton />
          <SettingsButton />
        </Flex>

        <Flex size column gap={4}>
          <rsp.$
            $target={ColorList}
            ref={this.listRef}
            editable={real(this, 'edit')}
            onChange={
              (color, alt) => {
                batch(() => {
                  if (!alt) {
                    this.colorA = color;
                    this.picker = 0;
                  } else {
                    this.colorB = color;
                    this.picker = 1;
                  }
                });
              }
            }
          />

          <rsp.$
            $target={ColorPicker}
            isHSL={real(this, 'inHSL')}
            ref={this.pickerRef}
            onChange={(color, alt) => {
              batch(() => {
                if (alt) {
                  this.picker = 1;
                  this.colorB = color;
                } else {
                  this.picker = 0;
                  this.colorA = color;
                }
                this.listRef?.current?.setColor(color, alt);
              });
            }}
          />

          <Flex gap={4} wrap>
            <rsp.$
              $target={ColorView}
              index={real(this, 'indexA')}
              color={real(this, 'colorA')} />
            <rsp.$
              $target={ColorView}
              index={real(this, 'indexB')}
              color={real(this, 'colorB')} />
          </Flex>
        </Flex>
      </Flex>
    );
  }
}