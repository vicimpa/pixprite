import { Component } from "react";
import { ColorSection } from "./ColorSection/ColorSection";
import { TimelineView } from "./TimelineView";
import { InfoView } from "./InfoView";
import { Flex } from "./ui/Flex";
import { CanvasSection } from "./CanvasSection";

export class SpriteEditor extends Component {
  render() {
    return (
      <Flex size column>
        <Flex size>
          <Flex column size={200}>
            <ColorSection />
          </Flex>
          <Flex size column>
            <Flex size column>
              <CanvasSection />
            </Flex>
            <Flex column size={200} resize>
              <TimelineView />
            </Flex>
          </Flex>
          <Flex size={32} column>
            <Flex size />
          </Flex>
        </Flex>
        <Flex size={24}>
          <InfoView defaultInfo="Pixprite v0.0.0" />
        </Flex>
      </Flex>
    );
  }
}