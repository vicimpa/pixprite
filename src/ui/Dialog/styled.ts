import styled from "styled-components";

export const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--backdrop);
`;

export const Window = styled.form`
  min-width: 240px;
  /* Long text wraps instead of stretching the window (dialogs that set a width keep it) */
  max-width: min(560px, calc(100vw - 16px));
  &[data-wide=true] { max-width: calc(100vw - 16px); }
  max-height: calc(100vh - 16px);
  display: flex;
  flex-direction: column;
  background-color: var(--bg);
  border: 1px solid var(--b1);
  box-shadow: inset 1px 1px 0 var(--hilite), 4px 4px 0 var(--shadow);
`;

export const TitleBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--row);
  padding: 0 4px 0 8px;
  background-color: var(--sel);
  color: var(--sel-fg);
  cursor: move;
  flex-shrink: 0;

  &[data-close-left=true] {
    flex-direction: row-reverse;
    justify-content: flex-end;
    gap: 6px;
    padding: 0 8px 0 4px;
  }
`;

export const Close = styled.button`
  width: calc(var(--row) - 6px);
  height: calc(var(--row) - 6px);
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;

  &:hover {
    background-color: var(--danger);
  }
`;

export const Body = styled.div`
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;

  /* Checkbox captions and hints wrap inside the window (tool bars keep them on one line) */
  & label { white-space: normal; flex-shrink: 1; min-width: 0; line-height: 1.3; }
  & label > input[type=checkbox] { flex-shrink: 0; align-self: flex-start; margin-top: 2px; }
  & > span { white-space: normal; line-height: 1.35; }
`;

export const Footer = styled.div`
  display: flex;
  /* Long button captions (e.g. in Russian) move to the next line instead of overflowing the window */
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 10px 8px;
  border-top: 1px solid var(--b2);
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

export const FieldLabel = styled.span`
  min-width: 6em;
  color: var(--fg-dim);
`;

export const Section = styled.div`
  color: var(--accent);
  border-bottom: 1px solid var(--b2);
  padding-bottom: 2px;
  margin-top: 4px;
`;
