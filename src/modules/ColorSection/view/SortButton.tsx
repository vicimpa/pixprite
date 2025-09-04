import { InfoView } from "$modules/InfoView";
import { Btn } from "../ColorBlocks";

export const SortButton = () => {

  return (
    <InfoView.Item info="Выбрать сортировку">
      <Btn className="i-sort" />
    </InfoView.Item>
  );
};