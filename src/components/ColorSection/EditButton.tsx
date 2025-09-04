import type { FC } from "react";
import type { ColorSection } from "./ColorSection";
import { useSignals } from "@preact/signals-react/runtime";
import { InfoView } from "../InfoView";
import { computed } from "@preact/signals-react";
import { Btn } from "./ColorBlocks";

export const EditButton: FC<{ section: ColorSection; }> = ({ section }) => {
  useSignals();

  return (
    <InfoView.Item info={computed(() => `${section.edit ? 'Выключить' : 'Включить'} редактирование`)}>
      <Btn
        data-active={section.edit}
        className={section.edit ? 'i-unlock' : `i-lock`}
        onClick={() => section.edit = !section.edit} />
    </InfoView.Item>
  );
};