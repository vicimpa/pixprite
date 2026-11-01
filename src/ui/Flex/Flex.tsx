import { createElement, forwardRef, type ComponentProps, type CSSProperties } from 'react';
import '@pixprite/ui/elements';
export type FlexDir = CSSProperties['justifyContent'];
export type FlexProps = {
  $column?: boolean; $reverse?: boolean; $content?: FlexDir; $items?: FlexDir;
  $gap?: number; $grow?: true | number; $padding?: string | number; $basis?: number;
  $inline?: boolean; $inset?: true | number; $shrink?: number;
};
export const Flex = forwardRef<HTMLDivElement, ComponentProps<'div'> & FlexProps>(function Flex({
  $column, $reverse, $content, $items, $gap, $grow, $padding, $basis, $inline, $inset, $shrink, ...props
}, ref) {
  return createElement('px-flex', {
    ...props, ref, direction: $column ? 'column' : 'row', reverse: $reverse ? '' : undefined,
    content: $content, items: $items, gap: $gap, grow: $grow ? +$grow : undefined,
    padding: $padding, basis: $basis, inline: $inline ? '' : undefined,
    inset: $inset === true ? '0' : $inset, shrink: $shrink,
  });
});
