import styled from "styled-components";

export const GridView = styled.div<{ $size?: number; }>`
  --csize: ${p => p.$size ?? 16}px;
  --dsize1: calc(var(--csize) / 2);
  --dsize2: calc(var(--csize) / -2);

  background-image: linear-gradient(45deg, #ccc 25%, transparent 25%),
                    linear-gradient(-45deg, #ccc 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #ccc 75%),
                    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: var(--csize) var(--csize);
  background-position: 0 0, 0 var(--dsize1), var(--dsize1) var(--dsize2), var(--dsize2) 0px;
`;
