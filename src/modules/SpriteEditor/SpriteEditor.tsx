import { Component } from "react";
import { ColorSection } from "../ColorSection";
import { TimelineView } from "../TimelineView";
import { InfoView } from "../InfoView";
import { Flex } from "$ui/Flex";
import { CanvasSection } from "../CanvasSection";
import { connect, provide } from "@vicimpa/react-decorators";
import { signalRef } from "$utils/signal";
import { ToolsView } from "../ToolsView";
import { prop, reactive } from "@vicimpa/decorators";
import detectInput from "./plugins/detectInput";

@provide()
@reactive()
@connect(detectInput)
export class SpriteEditor extends Component {
  color = signalRef<ColorSection>();
  canvas = signalRef<CanvasSection>();
  timeline = signalRef<TimelineView>();
  tools = signalRef<ToolsView>();

  @prop ctrlKey = false;
  @prop metaKey = false;
  @prop shiftKey = false;
  @prop altKey = false;

  render() {
    return (
      <Flex size column>
        <Flex size gap={8} >
          <Flex column size={200} resize>
            <ColorSection ref={this.color} />
          </Flex>
          <Flex size column gap={8}>
            <Flex size column>
              <CanvasSection ref={this.canvas} />
            </Flex>
            <Flex column size={200} resize start>
              <TimelineView ref={this.timeline} />
            </Flex>
          </Flex>
          <Flex size={32} column>
            <ToolsView ref={this.tools} />
          </Flex>
        </Flex>
        <Flex size={24}>
          <InfoView defaultInfo={
            <p>
              Pixprite v0.0.0
              {' '}
              <a
                href="https://github.com/vicimpa/pixprite"
                target="_blank"
                className="text-blue-500"
              >
                GitHub
              </a>
            </p>
          } />
        </Flex>
      </Flex>
    );
  }
}