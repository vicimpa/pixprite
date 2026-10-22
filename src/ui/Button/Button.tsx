import styled, { css } from "styled-components";

/** Raised pixel bevel shared by buttons and other clickable faces */
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

const ButtonBase = styled.button<{ $active?: boolean; $square?: boolean; $size?: number; $primary?: boolean; }>`
  ${bevel}
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: ${p => p.$size ? `${p.$size}px` : 'var(--row)'};
  ${p => p.$square ? `width: ${p.$size ? `${p.$size}px` : 'var(--row)'};` : 'padding: 0 .5em 1px;'}
  flex-shrink: 0;
  cursor: pointer;
  white-space: nowrap;
  color: var(--fg);

  ${p => p.$primary && css`
    background-color: var(--accent);
    color: var(--accent-fg);
  `}

  ${p => p.$active && css`
    background-color: var(--sel);
    color: var(--sel-fg);
    box-shadow: inset 1px 1px 0 var(--shadow-inset);
  `}

  &:hover:not(:disabled) {
    ${p => !p.$active && !p.$primary && 'background-color: var(--face-hot);'}
  }

  &:active:not(:disabled) {
    background-color: ${p => p.$active ? 'var(--sel)' : 'var(--face-down)'};
    box-shadow: inset 1px 1px 0 var(--shade);
    padding-top: ${p => p.$square ? 0 : 1}px;
  }

  &:disabled {
    color: var(--fg-dim);
    cursor: default;
    opacity: .6;
  }
`;

export const Input = styled.input`
  ${sunken}
  height: var(--row);
  width: 3.6em;
  padding: 0 4px;
  user-select: text;

  &[type=number]::-webkit-inner-spin-button {
    opacity: .5;
  }

  &:focus {
    border-color: var(--accent);
  }
`;


const LabelBase = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  cursor: pointer;
  flex-shrink: 0;
`;

export const Separator = styled.div`
  width: 1px;
  align-self: stretch;
  margin: 3px 2px;
  background-color: var(--b2);
  flex-shrink: 0;
`;

export const Check = styled.input.attrs({ type: 'checkbox' })`
  appearance: none;
  ${sunken}
  width: calc(var(--font-size) + 2px);
  height: calc(var(--font-size) + 2px);
  cursor: pointer;
  flex-shrink: 0;

  &:checked {
    background:
      linear-gradient(var(--accent), var(--accent)) center / 6px 6px no-repeat,
      var(--field);
  }
`;

export const Range = styled.input.attrs({ type: 'range' })`
  appearance: none;
  height: var(--row);
  width: 6em;
  background: transparent;
  cursor: pointer;

  &::-webkit-slider-runnable-track {
    ${sunken}
    height: 8px;
  }

  &::-webkit-slider-thumb {
    appearance: none;
    ${bevel}
    width: 8px;
    height: 14px;
    margin-top: -4px;
  }
`;

const MutedBase = styled.span`
  color: var(--fg-dim);
  white-space: nowrap;
`;

export const Button = ButtonBase;
export { Select } from "~/ui/Select";
export const Label = LabelBase;
export const Muted = MutedBase;
