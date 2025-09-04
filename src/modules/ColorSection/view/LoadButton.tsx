import { ColorSection } from "../ColorSection";
import { Dropdown } from "$ui/Dropdown";
import { InfoView } from "$modules/InfoView";
import { Btn } from "../ColorBlocks";
import { paletteCollection } from "$utils/palettes";
import { useInject } from "@vicimpa/react-decorators";

export const LoadButton = () => {
  const section = useInject(ColorSection);

  return (
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
};