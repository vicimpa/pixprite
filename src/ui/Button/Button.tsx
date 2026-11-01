import { css } from 'styled-components';

export { Button, Input, Check, Range, Label, Muted, Separator, Select } from '@pixprite/ui/react';

/** Shared theme tokens for editor-specific surfaces which are not controls. */
export const bevel = css`
  background-color: var(--face);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), inset -1px -2px 0 var(--shade);
`;

export const sunken = css`
  background-color: var(--field);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--shade);
`;
