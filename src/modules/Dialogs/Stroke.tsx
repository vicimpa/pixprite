import { t } from "~/core/i18n";
import { state } from "~/core/State";
import { paintSelection, type StrokePlace } from "~/core/Tools";
import { Input, Select } from "~/ui/Button";
import { Dialog, FieldLabel, openDialog, Row } from "~/ui/Dialog";
import { useState, type FC } from "react";

let lastWidth = 1;
let lastPlace: StrokePlace = 'inside';

const StrokeSelection: FC<{ close: () => void; }> = ({ close }) => {
  const [width, setWidth] = useState(lastWidth);
  const [place, setPlace] = useState<StrokePlace>(lastPlace);
  return (
    <Dialog title={t('dialog.strokeSelection.title')} onClose={close} onSubmit={() => {
      lastWidth = width; lastPlace = place;
      if (paintSelection(width, place, 'Stroke selection')) state.save();
    }}>
      <Row><FieldLabel>{t('common.width')}</FieldLabel>
        <Input type="number" min={1} max={256} value={width} style={{ width: 56 }}
          onChange={e => setWidth(Math.max(1, Math.min(256, Math.round(+e.target.value) || 1)))} />
      </Row>
      <Row><FieldLabel>{t('dialog.strokeSelection.position')}</FieldLabel>
        <Select value={place} onChange={e => setPlace(e.target.value as StrokePlace)}>
          <option value="inside">{t('dialog.strokeSelection.inside')}</option>
          <option value="center">{t('dialog.strokeSelection.centeredOnTheEdge')}</option>
          <option value="outside">{t('dialog.strokeSelection.outside')}</option>
        </Select>
      </Row>
    </Dialog>
  );
};

/** Outlines the selection with the current colors, ink, pattern or custom brush */
export const strokeSelectionDialog = () => openDialog(close => <StrokeSelection close={close} />);
