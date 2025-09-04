import { ColorSection } from "../ColorSection";
import { useSignals } from "@preact/signals-react/runtime";
import { InfoView } from "$modules/InfoView";
import { computed } from "@preact/signals-react";
import { Btn } from "../ColorBlocks";
import { useInject } from "@vicimpa/react-decorators";

export const EditButton = () => {
  useSignals();

  const section = useInject(ColorSection);

  return (
    <InfoView.Item info={computed(() => `${section.edit ? 'Выключить' : 'Включить'} редактирование`)}>
      <Btn
        data-active={section.edit}
        className={section.edit ? 'i-unlock' : `i-lock`}
        onClick={() => section.edit = !section.edit} />
    </InfoView.Item>
  );
};