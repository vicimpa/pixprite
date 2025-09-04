import { Component } from "react";
import { CSSVariables } from "./CSSVariables";
import { prop, reactive } from "@vicimpa/decorators";
import { Color } from "../core/Color";
import styled from "styled-components";
import { array, dispose } from "../utils/misc";
import { batch, computed, effect, signal } from "@preact/signals-react";
import { InfoView } from "./InfoView";
import { ColorInfo } from "./ColorInfo";
import { GridView } from "./GridView";
import { connect } from "@vicimpa/react-decorators";

import defaultPalette from "../assets/palettes/Default.gpl?raw";
import { parsePalette } from "../utils/color";

const LIST_GAP = 0;
const DEFAULT_PALETTE = parsePalette(defaultPalette);

const ColorItem = styled.div`
  width: var(--size);
  height: var(--size);
  cursor: pointer;
  position: relative;
  border-width: 1px;
  border-color: #000;
  

  &::before,
  &::after {
    content: '';
    position: absolute;
    width: 30%;  
    height: 30%;
    opacity: 0; 
    background: #fff;
    mix-blend-mode: difference;
  }

  &[data-active-a="true"], &[data-active-b="true"] {
    border-color: #fff;
  }
 
  &[data-active-a="true"]::before {
    top: 0;
    left: 0;
    opacity: 1;
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }

  &[data-active-b="true"]::after {
    right: 0;
    bottom: 0;
    opacity: 1;
    border-radius: 100% 0% 0% 0%;
    clip-path: polygon(100% 100%, 0 100%, 100% 0);
  }
`;

const ListContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-content: start;
  overflow-y: auto;
  gap: ${LIST_GAP}px;
`;

export type ColorListProps = {
  editable?: boolean;
  onChange?: (color: Color, alt: boolean) => any;
};

@connect((self) => (
  dispose(
    effect(() => {
      if (self.indexA !== undefined && self.indexA >= self.size)
        self.indexA = undefined;

      if (self.indexB !== undefined && self.indexB >= self.size)
        self.indexB = undefined;
    }),
  )
))
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
          <InfoView.Item key={i} info={<ColorInfo color={color} i={i} />}>
            <GridView $size={this.colorSize / 2} >
              <ColorItem
                data-active-a={this.indexA === i}
                data-active-b={this.indexB === i}
                onMouseDown={({ button }) => {
                  if (button === 1)
                    return;

                  batch(() => {
                    if (button === 0) {
                      this.indexA = this.indexA === i ? undefined : i;
                      this.indexB = this.indexB === i ? undefined : this.indexB;
                    }

                    if (button === 2) {
                      this.indexA = this.indexA === i ? undefined : this.indexA;
                      this.indexB = this.indexB === i ? undefined : i;
                    }
                  });
                  this.props.onChange?.(this.data[i].value.clone(), button === 2);
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
        <div className="grow-1 relative">
          <ListContainer className="p-1 bg-gray-900 absolute inset-0">
            {this.colorView}
          </ListContainer>
        </div>
      </CSSVariables>
    );
  }
}