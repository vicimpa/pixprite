import type { Color } from "~/core/Color";
import { t } from "~/core/i18n";
import { Input, Button } from "~/ui/Button";
import { cleanHexInput, parseHex } from "~/ui/HexInput/hex";
import { useEffect, useState, type FC } from "react";
import styled from "styled-components";

export { cleanHexInput, parseHex } from "~/ui/HexInput/hex";

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 0;
  flex-shrink: 0;
`;

const Prefix = styled.span`
  color: var(--fg-dim);
  min-width: 1em;
  text-align: center;
`;

/** HEX field with A/B toggle. */
export type HexInputProps = {
  /** Color being edited */
  color: Color;
  /** Whether editing secondary (B) */
  alt: boolean;
  /** Toggle A/B */
  onToggleAlt: (alt: boolean) => void;
  /** Called with a new color when the input becomes valid */
  onColorChange: (color: Color) => void;
};

export const HexInput: FC<HexInputProps> = ({ color, alt, onToggleAlt, onColorChange }) => {
  const [text, setText] = useState(() => color.toHexString(color.rgba[3] !== 1).replace('#', ''));
  const [typing, setTyping] = useState(false);
  
  useEffect(() => {
    if (!typing) setText(color.toHexString(color.rgba[3] !== 1).replace('#', ''));
  }, [color, typing]);

  const commit = (value: string, final = false) => {
    const cleaned = cleanHexInput(value);
    setText(cleaned);
    const parsed = parseHex(cleaned);
    if (parsed) {
      onColorChange(parsed);
    } else if (final) {
      // Restore valid color on blur if input was invalid
      setText(color.toHexString(color.rgba[3] !== 1).replace('#', ''));
    }
  };

  return (
    <Row data-hex-input>
      <Button 
        $square 
        $active={!alt} 
        title={t('colors.editPrimaryHint')} 
        onClick={() => onToggleAlt(false)}
      >A</Button>
      <Button 
        $square 
        $active={alt} 
        title={t('colors.editSecondaryHint')} 
        onClick={() => onToggleAlt(true)}
      >B</Button>
      <Prefix aria-hidden="true">#</Prefix>
      <Input
        value={text}
        aria-label={t('colors.hex')}
        title={t('colors.hexHint')}
        spellCheck={false}
        autoComplete="off"
        style={{ flexGrow: 1, minWidth: 0 }}
        onFocus={e => { setTyping(true); e.currentTarget.select(); }}
        onBlur={() => {
          setTyping(false);
          commit(text, true);
        }}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setText(color.toHexString(color.rgba[3] !== 1).replace('#', ''));
            e.currentTarget.blur();
          }
        }}
        onPaste={e => {
          const pasted = e.clipboardData?.getData('text');
          if (pasted === undefined) return;
          e.preventDefault();
          commit(pasted);
        }}
        onChange={e => commit(e.target.value)}
      />
    </Row>
  );
};