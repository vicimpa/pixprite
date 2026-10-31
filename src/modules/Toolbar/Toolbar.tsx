import { t } from "~/core/i18n";
import { state, type ToolName } from "~/core/State";
import { TOOLS, type ToolGroup } from "~/core/Tools";
import { Icon } from "~/ui/Icon";
import { ExtWidgets } from "~/modules/Extensions";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useLayoutEffect, useRef, useState, type FC } from "react";
import { FloatingPanel } from "~/ui/AdaptiveBar/FloatingPanel";
import * as styled from "./styled";

const GROUPS: ToolGroup[] = ['select', 'move', 'draw', 'erase', 'fill', 'pick', 'lines', 'shapes', 'poly', 'fx', 'text', 'slice', 'view'];

/** Remembers which tool of a group was used last, so the group button shows it */
const lastInGroup = new Map<ToolGroup, ToolName>();

export const Toolbar: FC = () => {
  useSignals();
  const [flyout, setFlyout] = useState<{ group: ToolGroup; anchor: HTMLElement } | null>(null);
  const [more, setMore] = useState(false);
  const [capacity, setCapacity] = useState(GROUPS.length);
  const bar = useRef<HTMLDivElement>(null), extra = useRef<HTMLDivElement>(null), moreButton = useRef<HTMLButtonElement>(null);
  const hold = useRef(0);
  const current = TOOLS.find(t => t.name === state.tool)!;
  lastInGroup.set(current.group, current.name);
  useLayoutEffect(() => {
    const measure = () => {
      const available = bar.current!.clientHeight - 8 - extra.current!.offsetHeight;
      setCapacity(Math.max(1, Math.floor(available / (state.ui.tool * 11 + 12))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(bar.current!); observer.observe(extra.current!);
    measure();
    return () => observer.disconnect();
  }, [state.ui.tool]);
  useEffect(() => () => clearTimeout(hold.current), []);
  const visible = GROUPS.slice(0, capacity < GROUPS.length ? Math.max(0, capacity - 1) : GROUPS.length);
  if (visible.length && !visible.includes(current.group)) visible[visible.length - 1] = current.group;
  const hidden = GROUPS.filter(g => !visible.includes(g));
  const open = (group: ToolGroup, anchor: HTMLElement) => { setMore(false); setFlyout({ group, anchor }); };

  return (
    <styled.Bar ref={bar} data-tool-palette>
      {visible.map(group => {
        const tools = TOOLS.filter(t => t.group === group);
        const shown = TOOLS.find(t => t.name === lastInGroup.get(group)) ?? tools[0];
        const active = current.group === group;
        return (
          <styled.Tool
            key={group}
            data-active={active}
            aria-label={t(shown.title)}
            title={`${t(shown.title)} (${shown.key.toUpperCase()})${tools.length > 1 ? '\n' + t('toolbar.rightClickForMore') : ''}`}
            onPointerDown={e => {
              e.stopPropagation();
              if (e.button === 2) return open(group, e.currentTarget);
              const el = e.currentTarget;
              hold.current = window.setTimeout(() => tools.length > 1 && open(group, el), 400);
            }}
            onContextMenu={e => e.preventDefault()}
            onPointerCancel={() => clearTimeout(hold.current)}
            onPointerUp={() => clearTimeout(hold.current)}
            onPointerLeave={() => clearTimeout(hold.current)}
            onClick={() => { state.tool = shown.name; }}
          >
            <Icon name={shown.name} />
            {tools.length > 1 && <styled.Corner />}
          </styled.Tool>
        );
      })}

      {hidden.length > 0 && <styled.Tool ref={moreButton} title={t('toolbar.moreTools')} aria-label={t('toolbar.moreTools')}
        aria-expanded={more} aria-haspopup="dialog" onClick={() => { setFlyout(null); setMore(!more); }}>⋯</styled.Tool>}
      <div ref={extra} style={{ width: '100%' }}><ExtWidgets slot="toolbar" /></div>
      <FloatingPanel anchor={moreButton.current} open={more && hidden.length > 0} side label={t('toolbar.moreTools')} onClose={() => setMore(false)}>
        <styled.Palette>
          {hidden.map(group => <styled.ToolGroup key={group}>
            {TOOLS.filter(d => d.group === group).map(d => <styled.FlyItem as="button" key={d.name} data-active={state.tool === d.name}
              title={t(d.hint)} onClick={() => { state.tool = d.name; setMore(false); }}>
              <Icon name={d.name} /><span>{t(d.title)}</span><styled.Key>{d.key.toUpperCase()}</styled.Key>
            </styled.FlyItem>)}
          </styled.ToolGroup>)}
        </styled.Palette>
      </FloatingPanel>

      <FloatingPanel anchor={flyout?.anchor ?? null} open={!!flyout} side label={flyout ? t(TOOLS.find(d => d.group === flyout.group)!.title) : ''} onClose={() => setFlyout(null)}>
        {TOOLS.filter(d => d.group === flyout?.group).map(d => <styled.FlyItem as="button"
          key={d.name} data-active={state.tool === d.name} onClick={() => { state.tool = d.name; setFlyout(null); }}>
          <Icon name={d.name} /><span>{t(d.title)}</span><styled.Key>{d.key.toUpperCase()}</styled.Key>
        </styled.FlyItem>)}
      </FloatingPanel>
    </styled.Bar>
  );
};
