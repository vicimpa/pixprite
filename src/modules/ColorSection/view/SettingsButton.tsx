import { ColorSection } from "../ColorSection";
import { useSignals } from "@preact/signals-react/runtime";
import { InfoView } from "$modules/InfoView";
import { Dropdown } from "$ui/Dropdown";
import { Btn, ListItem } from "../ColorBlocks";
import { Flex } from "$ui/Flex";
import rsp from "@vicimpa/rsp";
import { real } from "@vicimpa/decorators";
import { useInject } from "@vicimpa/react-decorators";
import { SIZES } from "../ColorList";
import { TYPES } from "../ColorPicker";


export const SettingsButton = () => {
  useSignals();

  const section = useInject(ColorSection);

  const { value: list } = section.listRef;

  if (!list)
    return null;

  return (
    <InfoView.Item info="Настройки цветовов">
      <Dropdown>
        <Btn className="i-menu" />
        <Dropdown.Content>
          <Flex column>
            <hr />

            <ListItem><rsp.input type="checkbox" bind-checked={real(section, 'edit')} /> Именить палитру</ListItem>
            <ListItem
              onClick={() => {
                const size = +(prompt('Выберите размер палитры', '' + list.size) ?? '-');

                if (isNaN(size))
                  return;

                list.size = Math.min(size, list.data.length);
              }}
            >
              Размер палитры
            </ListItem>
            <hr />
            <p>Размер иконок:</p>
            {
              SIZES.map(([size, name], i) => (
                <ListItem key={i}>
                  <rsp.radio
                    value={size}
                    group={real(list, 'colorSize')} />

                  {name}
                </ListItem>
              ))
            }

            <p>Тип палитры:</p>
            {
              TYPES.map(([type, name], i) => (
                <ListItem key={i}>
                  <rsp.radio
                    value={type}
                    group={real(section, 'inHSL')} />
                  {name}
                </ListItem>
              ))
            }
          </Flex>
        </Dropdown.Content>
      </Dropdown>
    </InfoView.Item>
  );
};