import { ColorSection } from "../ColorSection";
import { useSignals } from "@preact/signals-react/runtime";
import { Btn } from "../ColorBlocks";
import { useInject } from "@vicimpa/react-decorators";

export const EditButton = () => {
  useSignals();

  const section = useInject(ColorSection);

  return (

    <Btn
      data-active={section.edit}
      className={section.edit ? 'i-unlock' : `i-lock`}
      onClick={() => section.edit = !section.edit} />
  );
};