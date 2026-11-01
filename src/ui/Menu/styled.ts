import styled from "styled-components";

/** Shared kit classes keep these native tags available to existing styled consumers. */
export const Bar = styled.div.attrs({ className: 'px-menu-bar' })``;
export const Title = styled.div.attrs({ className: 'px-menu-title' })``;
export const List = styled.div.attrs({ className: 'px-menu-list' })``;
export const Item = styled.div.attrs({ className: 'px-menu-item' })``;
export const Mark = styled.span.attrs({ className: 'px-menu-mark' })``;
export const Text = styled.span.attrs({ className: 'px-menu-text' })``;
export const Shortcut = styled.span.attrs({ className: 'px-menu-shortcut' })``;
export const Divider = styled.div.attrs({ className: 'px-menu-divider' })``;
