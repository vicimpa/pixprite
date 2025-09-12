
import { getValue } from "$utils/signals";
import { useComputed, useSignal } from "@preact/signals-react";
import { useEffect, useId, type FC, type PropsWithChildren } from "react";
import { Head } from "$ui/Head";

export type VariablesProps = Record<string, any> & PropsWithChildren;

export const Variables: FC<VariablesProps> = ({ children, ..._props }) => {
  const id = useId();
  const props = useSignal(_props);

  const text = useComputed(() => {
    var output = `#${id}{`;

    Object.entries(props.value)
      .forEach(([key, data]) => {
        output += `--${key}:${getValue(data)};`;
      });

    output += '}';
    return output;
  });

  useEffect(() => {
    props.value = _props;
  });

  return (
    <div id={id} className="contents">
      {children}
      <Head>
        <style>{text}</style>
      </Head>
    </div>
  );
};