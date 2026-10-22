import styled from "styled-components";

export const Screen = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background-color: var(--bg);
  color: var(--fg);
`;

export const Box = styled.div`
  max-width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
`;

export const Title = styled.div`
  color: var(--accent);
  font-size: 1.25em;
  line-height: 1.3;
`;

export const Text = styled.div`
  color: var(--fg-dim);
  line-height: 1.4;
`;
