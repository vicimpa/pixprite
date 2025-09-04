import type { FC } from "react";
import type { ColorSection } from "./ColorSection";
import { Dropdown } from "../ui/Dropdown";
import { InfoView } from "../InfoView";
import { Btn } from "./ColorBlocks";
import { paletteCollection } from "../../utils/palettes";

export const LoadButton: FC<{ section: ColorSection; }> = ({ section }) => (
  <Dropdown>
    <InfoView.Item info="Загрузить палитру">
      <Btn className="i-file" />
    </InfoView.Item>
    <Dropdown.Content>
      {
        Object.entries(Object.groupBy(paletteCollection, e => e.group ?? ''))
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([group, items = []], key) => {
            return (
              <div key={'g' + key}>
                {(group !== '-') ? <p className="text text-gray-500">{group}</p> : null}
                {
                  items.map((palette, i) => (
                    <p className="cursor-pointer text-small" key={i} onClick={() => {
                      palette.fetch()
                        .then(colors => {
                          section.listRef.current?.loadColors(colors);
                        });
                    }}>
                      {palette.name}
                    </p>
                  ))
                }
              </div>
            );
          })
      }
    </Dropdown.Content>
  </Dropdown>
);