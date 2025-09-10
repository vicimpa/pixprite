import { Head } from "$ui/Head";
import { css } from "$utils/inline";
import { value } from "$utils/signals";
import { useComputed, useSignal } from "@preact/signals-react";
import { useId, type FC, type PropsWithChildren } from "react";

export type VariablesProps = Record<string, any> & PropsWithChildren;

export const Variables: FC<VariablesProps> = ({ children, ..._props }) => {
  const id = useId();
  const props = useSignal(_props);

  props.value = _props;

  const variables = useComputed(() => {
    return (
      Object.entries(props.value)
        .map(([key, data]) => [key, value(data)])
    );
  });

  const style = useComputed(() => (
    css`
      #${id} {
        ${variables.value.map(([key, value]) => (`--${key}: ${value};`)).join('\n')}
      }
    `
  ));

  return (
    <div id={id} className="contents">
      {children}
      <Head>
        <style>{style}</style>
      </Head>
    </div>
  );
};