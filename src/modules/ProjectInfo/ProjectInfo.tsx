import { t } from "~/core/i18n";
import { cleanInfo, type ProjectInfo } from "~/core/Sprite";
import { Input } from "~/ui/Button";
import { Dialog, FieldLabel, openDialog, Row } from "~/ui/Dialog";
import { useState, type FC } from "react";
import styled from "styled-components";

/** Suggested genres; any other text is fine too */
const GENRES = ['platformer', 'topdown', 'rpg', 'shooter', 'puzzle', 'strategy', 'fighting', 'racing'];

const Area = styled(Input).attrs({ as: 'textarea' })`
  flex: 1;
  min-height: 4.5em;
  resize: vertical;
  line-height: 1.35;
`;

const Wide = styled(Input)`
  flex: 1;
  min-width: 0;
`;

/** The editable fields of the project info; tags are typed comma-separated */
export const InfoFields: FC<{ value: ProjectInfo; onChange: (info: ProjectInfo) => void; }> = ({ value, onChange }) => {
  const [tags, setTags] = useState((value.tags ?? []).join(', '));
  const set = (patch: ProjectInfo) => onChange({ ...value, ...patch });
  return (
    <>
      <Row>
        <FieldLabel>{t('info.author')}</FieldLabel>
        <Wide value={value.author ?? ''} onChange={e => set({ author: e.target.value })} />
      </Row>
      <Row>
        <FieldLabel>{t('info.genre')}</FieldLabel>
        <Wide value={value.genre ?? ''} list="pixprite-genres" onChange={e => set({ genre: e.target.value })} />
        <datalist id="pixprite-genres">{GENRES.map(g => <option key={g} value={t(`info.genres.${g}`)} />)}</datalist>
      </Row>
      <Row>
        <FieldLabel>{t('info.tags')}</FieldLabel>
        <Wide value={tags} placeholder={t('info.tagsHint')}
          onChange={e => { setTags(e.target.value); set({ tags: e.target.value.split(',') }); }} />
      </Row>
      <Row style={{ alignItems: 'flex-start' }}>
        <FieldLabel>{t('info.description')}</FieldLabel>
        <Area value={value.description ?? ''} onChange={(e: { target: { value: string; }; }) => set({ description: e.target.value })} />
      </Row>
    </>
  );
};

/** A dialog editing the info; `save` gets the cleaned result */
export const editProjectInfo = (title: string, info: ProjectInfo, save: (info: ProjectInfo) => void) => openDialog(close => {
  const Edit: FC = () => {
    const [value, setValue] = useState(info);
    return (
      <Dialog title={title} width={Math.min(420, innerWidth - 32)} onClose={close} onSubmit={() => save(cleanInfo(value))}>
        <InfoFields value={value} onChange={setValue} />
      </Dialog>
    );
  };
  return <Edit />;
});
