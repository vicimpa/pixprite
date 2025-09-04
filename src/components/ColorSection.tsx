import { Component, type FC } from "react";
import { ColorList } from "./ColorList";
import { ColorPicker } from "./ColorPicker";
import { ColorView } from "./ColorView";
import { prop, reactive } from "@vicimpa/decorators";
import { Color } from "../core/Color";
import { batch, computed, effect, untracked } from "@preact/signals-react";
import { signalRef } from "../utils/signal";
import { connect } from "@vicimpa/react-decorators";
import { dispose } from "../utils/misc";
import styled from "styled-components";
import { InfoView } from "./InfoView";
import { useSignals } from "@preact/signals-react/runtime";
import { Dropdown, DropdownContent } from "./Dropdown";
import { paletteCollection } from "../utils/palettes";

const Btn = styled.button`
  width: 14px;
  height: 14px;
  padding: 2px;
  border: 1px solid #999;
  text-align: center;
  cursor: pointer;
  font-size: 6px!important;
  background-color: #444;

  &[data-active=true] {
    background-color: #391bbf;
  }
  
  &[data-active=false] {
    background-color: #535355;
    opacity: 0.5;
  }
`;

const EditButton: FC<{ section: ColorSection; }> = ({ section }) => {
  useSignals();

  return (
    <InfoView.Item
      info={computed(() => `${section.edit ? 'Выключить' : 'Включить'} редактирование`)}
    >
      <Btn data-active={section.edit} onClick={() => section.edit = !section.edit}>
        <i className={section.edit ? 'i-unlock' : `i-lock`} />
      </Btn>
    </InfoView.Item>
  );
};

const LoadButton: FC<{ section: ColorSection; }> = ({ section }) => (
  <Dropdown>
    <InfoView.Item info="Загрузить палитру">
      <Btn>
        <i className="i-file" />
      </Btn>
    </InfoView.Item>
    <DropdownContent>
      <div className="bg-gray-900 sticky top-0">
        <p className="text">Выбери палитру</p>
        <hr />
      </div>
      {
        Object.entries(Object.groupBy(paletteCollection, e => e.group ?? ''))
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([group, items = []], key) => {
            return (
              <div key={'g' + key}>
                {(group !== '-') ? <p className="text text-gray-500">{group}</p> : null}
                {
                  items.map((palette, i) => (
                    <p className="cursor-pointer text-small" key={i} onClick={() => {
                      palette.fetch()
                        .then(colors => {
                          section.listRef.current?.loadColors(colors);
                        });
                    }}>
                      {palette.name}
                    </p>
                  ))
                }
              </div>
            );
          })
      }
    </DropdownContent>
  </Dropdown>
);

const SettingsButton: FC<{ section: ColorSection; }> = ({ section }) => {
  useSignals();

  const { value: list } = section.listRef;

  if (!list)
    return null;

  return (
    <InfoView.Item info="Настройки цветовов">
      <Dropdown>
        <Btn>
          <i className="i-menu" />
        </Btn>
        <DropdownContent>
          <div className="whitespace-nowrap text-small p-1 flex flex-col">
            <p>Размер иконок:</p>
            {
              computed(() => (
                <select
                  value={list.colorSize}
                  onInput={(e) => {

                    list.colorSize = +e.currentTarget.value;
                  }}
                >
                  <option value={10}>Маленькие иконки</option>
                  <option value={16}>Средние иконки</option>
                  <option value={24}>Большие иконки</option>
                </select>
              ))
            }

            <p>Вид палитры:</p>
            {
              computed(() => (
                <select
                  value={section.inHSL ? '2' : '1'}
                  onInput={(e) => {
                    section.inHSL = e.currentTarget.value === '2';
                  }}
                >
                  <option value={'1'}>Оттенок</option>
                  <option value={'2'}>Спектр</option>
                </select>
              ))
            }
          </div>
        </DropdownContent>
      </Dropdown>
    </InfoView.Item>
  );
};

@connect((self) => (
  dispose(
    effect(() => {
      const { colorA, colorB, picker } = self;
      const { value: ref } = self.pickerRef;
      if (!ref) return;
      untracked(() => {
        ref.fromColor(picker ? colorB : colorA);
      });
    })
  )
))
@reactive()
export class ColorSection extends Component {
  pickerRef = signalRef<ColorPicker>();
  listRef = signalRef<ColorList>();

  @prop inHSL = false;
  @prop edit = false;
  @prop colorA = new Color(255, 255, 0, 1);
  @prop colorB = new Color(125, 0, 255);
  @prop picker = 0;

  render() {
    return (
      <>
        <div className="flex basis-4 text-small gap-1 items-center">
          <i />
          <EditButton section={this} />
          <i />
          <InfoView.Item info="Выбрать сортировку">
            <Btn>
              <i className="i-sort" />
            </Btn>
          </InfoView.Item>
          <LoadButton section={this} />
          <SettingsButton section={this} />
        </div>
        <div className="flex gap-1 flex-col grow">
          {computed(() => (
            <ColorList
              ref={this.listRef}
              editable={this.edit}
              onChange={(color, alt) => {
                batch(() => {
                  if (!alt) {
                    this.colorA = color;
                    this.picker = 0;
                  } else {
                    this.colorB = color;
                    this.picker = 1;
                  }
                });
              }} />
          ))}
          {computed(() => (
            <ColorPicker
              isHSL={this.inHSL}
              key={this.inHSL + ''}
              ref={this.pickerRef}
              onChange={(color, alt) => {
                batch(() => {
                  if (alt) {
                    this.picker = 1;
                    this.colorB = color;
                  } else {
                    this.picker = 0;
                    this.colorA = color;
                  }
                  this.listRef?.current?.setColor(color, alt);
                });
              }} />
          ))}
          <div className="flex h-4 gap-1">
            <ColorView calc={() => this.colorA.toHex(true)} />
            <ColorView calc={() => this.colorB.toHex(true)} />
          </div>
        </div>
      </>
    );
  }
}