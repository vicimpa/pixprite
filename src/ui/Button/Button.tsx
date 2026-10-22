import { forwardRef, useState, type ChangeEvent, type ComponentProps } from "react";
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

const InputBase = styled.input`
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


/**
 * A number field keeps what is typed while it has focus and passes on only valid numbers within
 * min..max: the parents clamp their values, so passing a half-typed one (an emptied field, "1" on the
 * way to "15" with min 10) would snap it back at once and the field couldn't be cleared or retyped.
 * Leaving the field commits the typed text clamped (or the minimum when it isn't a number).
 */
const NumberInput = forwardRef<HTMLInputElement, ComponentProps<typeof InputBase>>(function NumberInput({ onChange, onBlur, value, ...props }, ref) {
  const [draft, setDraft] = useState<string | null>(null);
  const min = props.min !== undefined && props.min !== '' ? +props.min : -Infinity;
  const max = props.max !== undefined && props.max !== '' ? +props.max : Infinity;
  return (
    <InputBase {...props} ref={ref} value={draft ?? value ?? ''}
      onChange={e => {
        const text = e.target.value, n = Number(text);
        // Wheel and scrubbing (numberFields.ts) change it without focus: nothing to keep then
        setDraft(document.activeElement === e.target ? text : null);
        if (text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange?.(e);
      }}
      onBlur={e => {
        if (draft !== null) {
          const n = Number(draft);
          const v = Math.max(min, Math.min(max, draft.trim() !== '' && Number.isFinite(n) ? n : Number.isFinite(min) ? min : 0));
          if (String(v) !== String(value)) onChange?.({ ...e, target: Object.assign(e.target, { value: String(v) }), currentTarget: e.currentTarget } as ChangeEvent<HTMLInputElement>);
          setDraft(null);
        }
        onBlur?.(e);
      }} />
  );
});

/** Text and number fields; `type="number"` gets NumberInput's typing behaviour */
export const Input = forwardRef<HTMLInputElement, ComponentProps<typeof InputBase>>(function Input(props, ref) {
  return props.type === 'number' ? <NumberInput {...props} ref={ref} /> : <InputBase {...props} ref={ref} />;
});

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
