import { Flex } from "$ui/Flex";
import { Panel } from "$ui/Panel";
import { Component } from "react";

export type TimelineViewProps = {

};

export class TimelineView extends Component<TimelineViewProps> {
  render() {

    return (
      <>
        <Flex size={24}></Flex>
        <Flex size column>
          <Panel $width={'100%'} $height={'100%'}>
            In progress
          </Panel>
        </Flex>
      </>
    );
  }
}