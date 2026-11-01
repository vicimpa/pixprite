/** React adapters preserve native handles; behavior belongs to the custom elements. */
import { createElement, forwardRef, useLayoutEffect, useRef, type ComponentProps, type CSSProperties, type ReactNode, type Ref } from 'react';
import { registerPrimitives, type PxInput } from './primitives';
import { registerSelect, type PxSelect } from './select';
import { installStyles } from './base';

if (typeof customElements !== 'undefined') {
  registerPrimitives();
  registerSelect();
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

export type ButtonProps = ComponentProps<'button'> & { $active?: boolean; $square?: boolean; $size?: number; $primary?: boolean; };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ $active, $square, $size, $primary, className, ...props }, ref) {
  return createElement('px-button', {
    active: $active ? '' : undefined, square: $square ? '' : undefined,
    primary: $primary ? '' : undefined, size: $size,
  }, <button {...props} type={props.type ?? 'submit'} className={['px-ui-button', className].filter(Boolean).join(' ')} ref={ref} />);
});

export type InputProps = ComponentProps<'input'>;
/** Multiline text keeps native form, selection and keyboard behavior with the shared field style. */
export const TextArea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>(function TextArea({ className, ...props }, ref) {
  const control = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (control.current) installStyles(control.current.ownerDocument);
    assignRef(ref, control.current);
    return () => assignRef(ref, null);
  }, [ref]);
  return <textarea {...props} className={['px-ui-input', className].filter(Boolean).join(' ')} ref={control} />;
});
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ value, defaultValue, className, ...props }, ref) {
  const host = useRef<PxInput>(null);
  useLayoutEffect(() => {
    if (value !== undefined && host.current) host.current.value = String(value ?? '');
  });
  return createElement('px-input', { ref: host }, <input {...props} className={['px-ui-input', className].filter(Boolean).join(' ')} defaultValue={defaultValue ?? value} ref={ref} />);
});

export const Check = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Check({ className, ...props }, ref) {
  return createElement('px-checkbox', null, <input {...props} className={['px-ui-checkbox', className].filter(Boolean).join(' ')} type="checkbox" ref={ref} />);
});
export const Range = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Range({ className, ...props }, ref) {
  return createElement('px-range', null, <input {...props} className={['px-ui-range', className].filter(Boolean).join(' ')} type="range" ref={ref} />);
});
export const Label = forwardRef<HTMLLabelElement, ComponentProps<'label'>>(function Label({ className, ...props }, ref) {
  return createElement('px-label', null, <label {...props} className={['px-ui-label', className].filter(Boolean).join(' ')} ref={ref} />);
});
export const Muted = forwardRef<HTMLSpanElement, ComponentProps<'span'>>(function Muted({ className, ...props }, ref) {
  return createElement('px-muted', null, <span {...props} className={['px-ui-muted', className].filter(Boolean).join(' ')} ref={ref} />);
});
export const Separator = forwardRef<HTMLElement, ComponentProps<'div'>>(function Separator(props, ref) {
  return createElement('px-separator', { ...props, ref });
});

export type SelectProps = Pick<ComponentProps<'select'>, 'id' | 'name' | 'required' | 'form' | 'defaultValue' | 'aria-describedby' | 'aria-labelledby'> & {
  value?: string | number;
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void;
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
  className?: string;
  'aria-label'?: string;
};

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select({ value, onChange, children, ...props }, ref) {
  const host = useRef<PxSelect>(null);
  useLayoutEffect(() => {
    host.current?.refresh();
    assignRef(ref, host.current?.trigger ?? null);
    return () => assignRef(ref, null);
  });
  return createElement('px-select', { ref: host }, <select {...props} value={value} onChange={e => onChange?.(e)}>{children}</select>);
});
