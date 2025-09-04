import { Component } from "react";
import { Flex } from "./ui/Flex";

export class CanvasSection extends Component {

  render() {
    return (
      <>
        <Flex size={32}></Flex>
        <Flex size>
          <div className="bg-gray-900 absolute inset-0">
            In progress
          </div>
        </Flex>
      </>
    );
  }
}