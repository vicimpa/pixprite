import type { FC } from "react";

/** The app mark (the same pixel art as the favicon), scaled in whole pixels */
export const LogoMark: FC<{ size?: number; title?: string; }> = ({ size = 16, title = 'Pixprite' }) => (
  <img src="/favicon.svg" width={size} height={size} alt={title} draggable={false}
    style={{ imageRendering: 'pixelated', display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }} />
);
