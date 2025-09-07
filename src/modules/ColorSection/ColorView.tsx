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
  text-shadow: 
    -1px -1px 0px #000,
    1px 1px 0px #000,
    1px -1px 0px #000,
    -1px 1px 0px #000,
    -1px 0px 0px #000,
    1px 0px 0px #000, 
    0px -1px 0px #000, 
    0px 1px 0px #000;

  font-size: 16px;
  text-align: center;
`;


export class ColorView extends Component<ColorViewProps> {

  render() {
    const { color, index = -1 } = this.props;
    const backgroundColor = color.toHex(true);
    return (
      <GridView className="cursor-pointer min-w-40 h-6 relative grow-1">
        <Text style={{ backgroundColor }}>
          {index >= 0 ? `IDX: ${index}` : backgroundColor}
        </Text>
      </GridView>
    );
  }
}