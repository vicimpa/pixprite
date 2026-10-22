import { t } from "~/core/i18n";
import { state } from "~/core/State";
import { Flex } from "~/ui/Flex";
import { prop, reactive, real } from "@vicimpa/decorators";
import { provide } from "@vicimpa/react-decorators";
import { Component, type FC, type PropsWithChildren } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { ColorList } from "./modules/ColorList";
import { TilesPanel } from "./modules/TilesPanel";
import { signalRef } from "~/utils/signals";
import { ColorPicker, type PickerType } from "./modules/ColorPicker";
import { Button } from "~/ui/Button";
import { Icon } from "~/ui/Icon";
import { runCommand } from "~/core/Commands";
import { ColorView } from "./modules/ColorView";
import { ColorSliders } from "./modules/ColorSliders";
import * as styled from "./styled";
import { Splitter } from "~/ui/Splitter";
import { useEffect } from "~/utils/decorators";
import { batch, effect } from "@preact/signals-react";
import rsp from "@vicimpa/rsp";
import { dispose } from "~/utils/common";

const PickerSplitter: FC = () => {
  useSignals();
  return (
    <Splitter vertical={false} value={state.layout.pickerSize} dir={-1} min={120} max={600}
      onChange={v => state.setLayout({ pickerSize: v })} />
  );
};

const PickerBox: FC<PropsWithChildren> = ({ children }) => {
  useSignals();
  return <Flex $column $basis={state.layout.pickerSize} $shrink={0}>{children}</Flex>;
};

/** Function component so it re-renders from the `pickerType` signal */
const PickerTabs: FC<{ colors: Colors; }> = ({ colors }) => {
  useSignals();
  return (
    <>
      <Button $active={!colors.sliders && colors.pickerType === 'hsl'} onClick={() => { colors.sliders = false; colors.setPickerType('hsl'); }}>{t('colors.hsl')}</Button>
      <Button $active={!colors.sliders && colors.pickerType === 'hsv'} onClick={() => { colors.sliders = false; colors.setPickerType('hsv'); }}>{t('colors.hsv')}</Button>
      <Button $active={colors.sliders} title={t('colors.numericSlidersAndHex')} onClick={() => { colors.sliders = true; }}>{t('colors.rgb')}</Button>
    </>
  );
};

/** Either the 2D picker or the numeric sliders */
const PickerArea: FC<{ colors: Colors; children: React.ReactNode; }> = ({ colors, children }) => {
  useSignals();
  return (
    <>
      <div className="contents" style={{ display: colors.sliders ? 'none' : 'contents' }}>{children}</div>
      {colors.sliders && <div style={{ position: 'relative', flexGrow: 1 }}><ColorSliders alt={colors.pickerAlt} /></div>}
    </>
  );
};

@reactive()
@provide()
export class Colors extends Component {
  picker = signalRef<ColorPicker>();

  get colorA() { return state.colorA; }
  set colorA(v) { state.colorA = v; }

  get colorB() { return state.colorB; }
  set colorB(v) { state.colorB = v; }

  @prop pickerAlt = false;

  get current() {
    return this.pickerAlt ? this.colorB : this.colorA;
  }

  set current(v) {
    this[this.pickerAlt ? 'colorB' : 'colorA'] = v;
  }

  @useEffect()
  detectChange() {
    return dispose(
      effect(() => {
        this.picker.value?.setColor(this.current);
      })
    );
  }

  /** The picker choice lives in the layout, so it survives reloads */
  get pickerType(): PickerType { return state.layout.pickerTab === 'hsv' ? 'hsv' : 'hsl'; }
  get sliders() { return state.layout.pickerTab === 'rgb'; }
  set sliders(v: boolean) { if (v) state.setLayout({ pickerTab: 'rgb' }); }

  setPickerType(type: PickerType) {
    state.setLayout({ pickerTab: type === 'hsv' ? 'hsv' : 'hsl' });
    if (this.picker.value) this.picker.value.type = type;
  }

  @useEffect()
  syncPicker() {
    return effect(() => {
      const type = this.pickerType;
      if (this.picker.value) this.picker.value.type = type;
    });
  }

  render() {
    return (
      <Flex $inset $column>
        <Flex $items="center" $gap={4} $padding="4px 4px 0" $shrink={0}>
          <PickerTabs colors={this} />
          <span style={{ flexGrow: 1 }} />
          <Button $square title={t('colors.swapColorsX')} onClick={() => runCommand('color.swap')}><Icon name="swap" scale="glyph" /></Button>
          <Button title={t('colors.blackAndWhiteD')} onClick={() => runCommand('color.reset')}>{t('colors.bW')}</Button>
        </Flex>
        <Flex $grow>
          <Flex $inset $column $gap={0}>
            <Flex $grow>
              <ColorList />
            </Flex>
            <TilesPanel />
            <PickerSplitter />
            <PickerBox>
              <PickerArea colors={this}>
              <ColorPicker
                ref={this.picker}
                onChange={(color, alt) => {
                  batch(() => {
                    this.pickerAlt = alt;
                    this.current = color;
                  });
                }} />
              </PickerArea>
            </PickerBox>
          </Flex>
        </Flex>
        <styled.FlexWrap $gap={4} $items="stretch">
          <rsp.$ $target={ColorView} color={real(state, 'colorA')}
            onClick={() => { this.pickerAlt = false; }} />
          <rsp.$ $target={ColorView} color={real(state, 'colorB')}
            onClick={() => { this.pickerAlt = true; }} />
        </styled.FlexWrap>
      </Flex>
    );
  }
}