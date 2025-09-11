import { Flex } from "$ui/Flex";
import { Panel } from "$ui/Panel";
import { Resizer } from "$ui/Resizer";
import { Component } from "react";

export class Editor extends Component {


  render() {
    return (
      <Flex $inset>
        <Flex $grow>
          <Flex $inset $column>
            <Flex $basis={32}>
              {/* Instrument params */}
            </Flex>
            <Flex $grow>
              <Flex $column $inset>
                <Flex $grow>
                  {/* Canvas */}
                  <Panel />
                </Flex>
              </Flex>
            </Flex>
            <Flex $basis={256}>
              {/* Timeline */}
              <Panel />
              <Resizer start />
            </Flex>
          </Flex>
        </Flex>
        <Flex $basis={32}>
          {/* Instruments */}
          <Resizer start />
        </Flex>
      </Flex>
    );
  }
}