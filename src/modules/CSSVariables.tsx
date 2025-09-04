import { useComputed } from "@preact/signals-react";
import type { PropsWithChildren } from "react";
import rsp from "@vicimpa/rsp";
import type { CSSProperties } from "styled-components";

export type CSSVariablesProps = {
  calc: () => Record<string, any>;
} & PropsWithChildren;

export const CSSVariables = ({ calc, children }: CSSVariablesProps) => {
  const variables = useComputed(() => {
    const object: Record<string, string> = {}, result = calc();

    for (const key in result) {
      object['--' + key] = String(result[key]);
    }

    return object as CSSProperties;
  });

  return (
    <rsp.div style={variables} className="contents">
      {children}
    </rsp.div>
  );
};