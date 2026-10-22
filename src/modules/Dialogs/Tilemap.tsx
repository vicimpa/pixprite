import { t } from "~/core/i18n";
import { state } from "~/core/State";
import { Input, Muted, Select } from "~/ui/Button";
import { Dialog, FieldLabel, openDialog, Row } from "~/ui/Dialog";
import { useState, type FC } from "react";

/** Asks for the tile size, then makes a new tilemap layer or converts the active one */
const TileSize: FC<{ close: () => void; convert: boolean; }> = ({ close, convert }) => {
  const [w, setW] = useState(state.prefs.gridW);
  const [h, setH] = useState(state.prefs.gridH);
  // New tilemap layers may share an existing tileset (-1 = a new one)
  const [shared, setShared] = useState(-1);
  const sets = state.sprite.tilesets;
  const fixed = !convert && sets[shared];
  return (
    <Dialog title={convert ? 'Convert to tilemap' : 'New tilemap layer'} onClose={close} submitLabel={convert ? t('common.convert') : t('common.create')} onSubmit={() => {
      const { sprite } = state;
      if (convert) sprite.convertToTilemap(w, h);
      else if (fixed) sprite.addTilemapLayer(fixed.tw, fixed.th, shared);
      else sprite.addTilemapLayer(w, h);
      state.tilemapMode = 'pixels';
      state.showGrid = true;
      state.save();
    }}>
      {!convert && sets.length > 0 && (
        <Row>
          <FieldLabel>{t('common.tileset')}</FieldLabel>
          <Select value={shared} onChange={e => setShared(+e.target.value)}>
            <option value={-1}>{t('dialog.tileSize.newTileset')}</option>
            {sets.map((ts, i) => <option key={i} value={i}>{ts.name} ({ts.tw}×{ts.th}, {ts.tiles.length - 1})</option>)}
          </Select>
        </Row>
      )}
      {!fixed && <Row>
        <FieldLabel>{t('dialog.tileSize.title')}</FieldLabel>
        <Input type="number" min={1} max={256} value={w} onChange={e => setW(Math.max(1, +e.target.value | 0))} />×
        <Input type="number" min={1} max={256} value={h} onChange={e => setH(Math.max(1, +e.target.value | 0))} />
      </Row>}
      {convert
        ? <Muted>{t('dialog.tileSize.theLayerIsCut')}</Muted>
        : <Muted>{t('dialog.tileSize.paintPixelsAndThey')}</Muted>}
    </Dialog>
  );
};

/** Moves the active tilemap layer onto another tileset of the same tile size */
const ChangeTileset: FC<{ close: () => void; }> = ({ close }) => {
  const { sprite } = state;
  const cur = sprite.current?.tileset ?? -1, src = sprite.tilesets[cur];
  const options = sprite.tilesets.map((ts, i) => ({ ts, i })).filter(({ ts, i }) => i !== cur && src && ts.tw === src.tw && ts.th === src.th);
  const [target, setTarget] = useState(options[0]?.i ?? -1);
  const [rematch, setRematch] = useState(true);
  return (
    <Dialog title={t('dialog.changeTileset.title')} onClose={close} submitLabel={t('common.apply')} onSubmit={() => {
      if (target < 0) return;
      sprite.changeTileset(target, rematch);
      state.save();
    }}>
      {options.length ? <>
        <Row>
          <FieldLabel>{t('common.tileset')}</FieldLabel>
          <Select value={target} onChange={e => setTarget(+e.target.value)}>
            {options.map(({ ts, i }) => <option key={i} value={i}>{ts.name} ({ts.tw}×{ts.th}, {ts.tiles.length - 1})</option>)}
          </Select>
        </Row>
        <Row>
          <FieldLabel>{t('common.tiles')}</FieldLabel>
          <Select value={rematch ? 1 : 0} onChange={e => setRematch(e.target.value === '1')}>
            <option value={1}>{t('dialog.changeTileset.matchByPixelsAdd')}</option>
            <option value={0}>{t('dialog.changeTileset.keepTileNumbers')}</option>
          </Select>
        </Row>
      </> : <Muted>{t('dialog.changeTileset.noOtherTilesetWith')}</Muted>}
    </Dialog>
  );
};

export const tilemapDialogs = {
  changeTileset: () => openDialog(close => <ChangeTileset close={close} />),
  newTilemap: () => openDialog(close => <TileSize close={close} convert={false} />),
  toTilemap: () => openDialog(close => <TileSize close={close} convert />),
};
