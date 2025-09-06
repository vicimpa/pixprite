import { Component } from "react";
import { CSSVariables } from "../CSSVariables";
import { prop, reactive } from "@vicimpa/decorators";
import { Color } from "$core/Color";
import { array } from "$utils/misc";
import { batch, computed, signal } from "@preact/signals-react";
import { InfoView } from "../InfoView";
import { ColorInfo } from "./ColorInfo";
import { GridView } from "$ui/GridView";
import { connect, inject } from "@vicimpa/react-decorators";
import { ColorItem, ListContainer } from "./ColorBlocks";
import detectUnselect from "./plugins/detectUnselect";
import { paletteCollection } from "./palettes";
import { Panel } from "$ui/Panel";
import { MouseButton } from "$utils/mouse";

const DEFAULT_PALETTE = await paletteCollection[0].fetch();

export type ColorListProps = {
  editable?: boolean;
  onChange?: (color: Color, alt: boolean) => any;
};

@connect(detectUnselect)
@reactive()
export class ColorList extends Component<ColorListProps> {
  @prop data = array(1024, (i) => signal(DEFAULT_PALETTE[i]?.clone() ?? new Color()));
  @prop size = DEFAULT_PALETTE.length;
  @prop colorSize = 16;

  @prop indexA?: number;
  @prop indexB?: number;

  loadColors(colors: Color[]) {
    batch(() => {
      const size = Math.min(this.data.length, colors.length);
      for (let i = 0; i < size; i++) {
        this.data[i].value = colors[i].clone();
      }
      this.size = size;
      this.indexA = undefined;
      this.indexB = undefined;
    });
  }

  setColor(color: Color, alt: boolean) {
    batch(() => {
      if (!alt && this.indexA !== undefined) {
        if (this.props.editable)
          this.data[this.indexA].value = color.clone();
        else
          this.indexA = undefined;
        return;
      }

      if (alt && this.indexB !== undefined) {
        if (this.props.editable)
          this.data[this.indexB].value = color.clone();
        else
          this.indexB = undefined;
        return;
      }
    });
  }

  setSize(size: number) {
    this.colorSize = size;
  }

  colorView = computed(() => (
    array(Math.min(this.size, this.data.length), (i) => (
      computed(() => {
        const color = this.data[i].value;

        return (
          <InfoView.Item key={i} info={<ColorInfo color={color} prefix={`Index ${i}`} />}>
            <GridView $size={this.colorSize / 2} >
              <ColorItem
                data-active-a={this.indexA === i}
                data-active-b={this.indexB === i}
                onMouseDown={({ button }) => {
                  if (button === MouseButton.MIDDLE)
                    return;

                  batch(() => {
                    if (button === MouseButton.LEFT) {
                      this.indexA = this.indexA === i ? undefined : i;
                      this.indexB = this.indexB === i ? undefined : this.indexB;

                      if (this.indexA !== undefined)
                        this.props.onChange?.(this.data[i].value.clone(), false);
                    }

                    if (button === MouseButton.RIGHT) {
                      this.indexA = this.indexA === i ? undefined : this.indexA;
                      this.indexB = this.indexB === i ? undefined : i;

                      if (this.indexB !== undefined)
                        this.props.onChange?.(this.data[i].value.clone(), true);
                    }
                  });
                }}
                style={{
                  backgroundColor: color.toHex(true)
                }} />
            </GridView>
          </InfoView.Item>
        );
      })
    ))
  ));

  getVariables() {
    return ({
      size: this.colorSize + 'px'
    });
  }

  render() {
    return (
      <CSSVariables calc={() => this.getVariables()}>
        <Panel className="grow-1 relative">
          <ListContainer>
            {this.colorView}
          </ListContainer>
        </Panel>
      </CSSVariables>
    );
  }
}