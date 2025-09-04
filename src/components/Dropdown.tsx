import { useSignals } from "@preact/signals-react/runtime";
import { prop, reactive } from "@vicimpa/decorators";
import { provide, useInject } from "@vicimpa/react-decorators";
import { Component, type FC, type PropsWithChildren } from "react";
import { OutsideClick } from "./OutsideClick";


@reactive()
@provide()
export class Dropdown extends Component<PropsWithChildren> {
  @prop open = false;

  render() {
    return (
      <OutsideClick onOutsideClick={() => this.open = false}>
        <div className="relative" onClick={() => this.open = !this.open}>
          {this.props.children}
        </div>
      </OutsideClick>
    );
  }
}

export const DropdownContent: FC<PropsWithChildren> = (props) => {
  const dropdown = useInject(Dropdown);
  useSignals();

  return (
    dropdown.open ? (
      <div
        onClick={e => e.stopPropagation()}
        className="absolute top-full z-1 bg-gray-900 border-1 border-color-gray-500 max-h-50 overflow-y-scroll">
        {props.children}
      </div>
    ) : null
  );
};