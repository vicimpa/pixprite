import { Component } from "react";
import { ViewCanvas } from "./CanvasView";
import { ColorSection } from "./ColorSection";
import { TimelineView } from "./TimelineView";
import { InfoView } from "./InfoView";
import { signalRef } from "../utils/signal";

export class SpriteEditor extends Component {
  colorSection = signalRef<ColorSection>();
  viewCanvas = signalRef<ViewCanvas>();
  timelineView = signalRef<TimelineView>();

  render() {
    return (
      <div className="flex flex-col w-full h-full gap-1 p-1">
        <div className="flex grow-1 gap-1">
          <div className="flex flex-col basis-30">
            <ColorSection ref={this.colorSection} />
          </div>
          <div className="flex flex-col gap-1 grow-1">
            <div className="flex flex-col grow-1">
              <div className="basis-4"></div>
              <div className="grow relative">
                <ViewCanvas ref={this.viewCanvas} />
              </div>
            </div>
            <div className="basis-30 flex flex-col gap-1">
              <TimelineView ref={this.timelineView} />
            </div>
          </div>
          <div className="basis-4"></div>
        </div>
        <div className="basis-4 flex items-center">
          <InfoView defaultInfo="Pixprite v0.0.0" />
        </div>
      </div>
    );
  }
}