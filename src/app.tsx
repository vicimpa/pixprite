import { Colors } from "$module/Colors";
import { Editor } from "$module/Editor";
import { Info } from "$module/Info";
import { Flex } from "$ui/Flex";
import { Resizer } from "$ui/Resizer";

export const App = () => {
  return (
    <Flex $inset $column>
      <Flex $grow>
        <Flex $inset>
          <Flex $basis={256}>
            <Colors />
            <Resizer />
          </Flex>
          <Flex $grow>
            <Editor />
          </Flex>
        </Flex>
      </Flex>
      <Flex $basis={32}>
        <Info />
      </Flex>
    </Flex>
  );
};