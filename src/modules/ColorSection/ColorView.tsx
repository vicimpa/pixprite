import { Component } from "react";
import { GridView } from "$ui/GridView";
import styled from "styled-components";
import type { Color } from "$core/Color";

export type ColorViewProps = {
  index?: number;
  color: Color;
};


const Text = styled.div`
  position: absolute;
  inset: 0;
`;

const Font = styled.label`
  position: absolute;
  inset: 0;
  text-align: center;
  font-size: 16px;
  color: #fff;

  text-shadow: 
  -1px -1px 0 #000,
  1px 1px 0 #000,
  1px -1px 0 #000,
  -1px 1px 0 #000,
  0 -1px 0 #000,
  0 1px 0 #000,
  -1px -0 0 #000,
  1px -0 0 #000;
`;


export class ColorView extends Component<ColorViewProps> {

  render() {
    const { color, index = -1 } = this.props;
    const backgroundColor = color.toHex(true);
    return (
      <GridView className="cursor-pointer h-6 relative grow-1 overflow-hidden">
        <Text style={{ backgroundColor }}>
          <Font>{index >= 0 ? `IDX: ${index}` : backgroundColor}</Font>
        </Text>
      </GridView>
    );
  }
}