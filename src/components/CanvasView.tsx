import { Component } from "react";

export type ViewCanvasProps = {
};

export class ViewCanvas extends Component<ViewCanvasProps> {

  render() {
    return (
      <div className="bg-gray-900 absolute inset-0">
        In progress
      </div>
    );
  }
}