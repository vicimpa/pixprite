import { t } from "~/core/i18n";
import { state, type ToolName } from "~/core/State";
import { TOOLS, type ToolGroup } from "~/core/Tools";
import { Icon } from "~/ui/Icon";
import { ExtWidgets } from "~/modules/Extensions";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState, type FC } from "react";
import { createPortal } from "react-dom";
import * as styled from "./styled";

const GROUPS: ToolGroup[] = ['select', 'move', 'draw', 'erase', 'fill', 'pick', 'lines', 'shapes', 'poly', 'fx', 'text', 'slice', 'view'];

/** Remembers which tool of a group was used last, so the group button shows it */
const lastInGroup = new Map<ToolGroup, ToolName>();

export const Toolbar: FC = () => {
  useSignals();
  const [flyout, setFlyout] = useState<{ group: ToolGroup; x: number; y: number; } | null>(null);
  const hold = useRef(0);
  const current = TOOLS.find(t => t.name === state.tool)!;
  lastInGroup.set(current.group, current.name);
  const left = state.layout.toolbar === 'left';

  useEffect(() => {
    if (!flyout) return;
    const close = () => setFlyout(null);
    addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [flyout]);

  const open = (group: ToolGroup, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setFlyout({ group, x: left ? r.right + 2 : r.left - 2, y: r.top });
  };

  return (
    <styled.Bar>
      {GROUPS.map(group => {
        const tools = TOOLS.filter(t => t.group === group);
        const shown = TOOLS.find(t => t.name === lastInGroup.get(group)) ?? tools[0];
        const active = current.group === group;
        return (
          <styled.Tool
            key={group}
            data-active={active}
            title={`${t(shown.title)} (${shown.key.toUpperCase()})${tools.length > 1 ? '\n' + t('toolbar.rightClickForMore') : ''}`}
            onPointerDown={e => {
              e.stopPropagation();
              if (e.button === 2) return open(group, e.currentTarget);
              const el = e.currentTarget;
              hold.current = window.setTimeout(() => tools.length > 1 && open(group, el), 400);
            }}
            onPointerUp={() => clearTimeout(hold.current)}
            onPointerLeave={() => clearTimeout(hold.current)}
            onClick={() => { state.tool = shown.name; }}
          >
            <Icon name={shown.name} />
            {tools.length > 1 && <styled.Corner />}
          </styled.Tool>
        );
      })}

      <ExtWidgets slot="toolbar" />

      {flyout && createPortal(
        <styled.Flyout
          style={left ? { left: flyout.x, top: flyout.y } : { right: innerWidth - flyout.x, top: flyout.y }}
          onPointerDown={e => e.stopPropagation()}
        >
          {TOOLS.filter(d => d.group === flyout.group).map(d => (
            <styled.FlyItem
              key={d.name}
              data-active={state.tool === d.name}
              onClick={() => { state.tool = d.name; setFlyout(null); }}
            >
              <Icon name={d.name} />
              <span>{t(d.title)}</span>
              <styled.Key>{d.key.toUpperCase()}</styled.Key>
            </styled.FlyItem>
          ))}
        </styled.Flyout>,
        document.body
      )}
    </styled.Bar>
  );
};
