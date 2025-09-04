import { Component } from "react";
import { computed } from "@preact/signals-react";
import rsp from "@vicimpa/rsp";
import { GridView } from "$ui/GridView";
import styled from "styled-components";

export type ColorViewProps = {
  calc?: () => string;
};

const Text = styled.p`
  text-shadow: 
    -1px -1px 0px #000,
    1px 1px 0px #000,
    1px -1px 0px #000,
    -1px 1px 0px #000,
    -1px 0px 0px #000,
    1px 0px 0px #000, 
    0px -1px 0px #000, 
    0px 1px 0px #000;

  transform: translateY(1px);
`;

export class ColorView extends Component<ColorViewProps> {
  color = computed(() => this.props.calc?.() ?? '#000');
  style = computed(() => ({ backgroundColor: this.color.value }));

  render() {
    return (
      <GridView className="cursor-pointer grow-1 border-1 border-gray-400">
        <rsp.div style={this.style} className="w-full h-full flex justify-center items-center aitems-center text-small">
          <Text>
            {this.color}
          </Text>
        </rsp.div>
      </GridView>
    );
  }
}