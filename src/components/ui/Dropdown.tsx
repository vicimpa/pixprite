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

  static Content: FC<PropsWithChildren> = (props) => {
    const dropdown = useInject(Dropdown);
    useSignals();

    return (
      dropdown.open ? (
        <div
          onClick={e => e.stopPropagation()}
          className="absolute w-max top-full z-1 bg-gray-900 border-1 border-color-gray-500 max-h-100 overflow-y-auto">
          {props.children}
        </div>
      ) : null
    );
  };
}