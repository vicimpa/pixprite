import { Component } from "react";

export type TimelineViewProps = {

};

export class TimelineView extends Component<TimelineViewProps> {
  render() {

    return (
      <>
        <div className="flex basis-4"></div>
        <div className="grow-1 bg-gray-900">
          In progress
        </div>
      </>
    );
  }
}