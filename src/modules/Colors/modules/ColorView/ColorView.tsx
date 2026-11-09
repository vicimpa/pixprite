import { Flex } from "~/ui/Flex";
import { Panel } from "~/ui/Panel";
import * as styled from "./styled";
import type { Color } from "~/core/Color";
import { useCallback, useRef, useState, type FC } from "react";
import { Variables } from "~/ui/Variables";
import { Grid } from "~/ui/Grid";
import { t } from "~/core/i18n";
import { ColorPopup } from "./ColorPopup";
import { useSignals } from "@preact/signals-react/runtime";

export type ColorViewProps = {
  color: Color;
  index?: number;
  alt?: boolean;
  onClick?: () => void;
};

export const ColorView: FC<ColorViewProps> = ({ color, index = -1, alt = false, onClick }) => {
  useSignals();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const label = alt ? t('colors.editSecondary') : t('colors.editPrimary');
  return (
    <>
    <styled.ColorBox ref={anchor} type="button" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
      onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}
      onClick={() => { onClick?.(); setOpen(v => !v); }}>
      <Panel>
        <Grid inset />
        <Variables color={color.toHexString(true)}>
          <styled.ColorView />
        </Variables>
        <Flex $inset $content="center" $items="center">
          <styled.ColorText>
            {
              index === -1 ? (
                color.toHexString(color.rgba[3] !== 1)
              ) : `IDS ${index}`
            }
          </styled.ColorText>
        </Flex>
      </Panel>
    </styled.ColorBox>
    {open && anchor.current && <ColorPopup alt={alt} anchor={anchor.current} onClose={close} />}
    </>
  );
};
