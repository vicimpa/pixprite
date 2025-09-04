import type { FC } from "react";
import type { ColorSection } from "./ColorSection";
import { useSignals } from "@preact/signals-react/runtime";
import { InfoView } from "../InfoView";
import { Dropdown } from "../ui/Dropdown";
import { Btn, ListItem } from "./ColorBlocks";
import { Flex } from "../ui/Flex";
import rsp from "@vicimpa/rsp";
import { real } from "@vicimpa/decorators";

export const SettingsButton: FC<{ section: ColorSection; }> = ({ section }) => {
  useSignals();

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
            <ListItem><rsp.radio value={16} group={real(list, 'colorSize')} />Маленький</ListItem>
            <ListItem><rsp.radio value={24} group={real(list, 'colorSize')} />Средний</ListItem>
            <ListItem><rsp.radio value={32} group={real(list, 'colorSize')} />Большой</ListItem>

            <p>Тип палитры:</p>
            <ListItem><rsp.radio value={false} group={real(section, 'inHSL')} /> Оттенок</ListItem>
            <ListItem><rsp.radio value={true} group={real(section, 'inHSL')} /> Спектр</ListItem>
          </Flex>
        </Dropdown.Content>
      </Dropdown>
    </InfoView.Item>
  );
};