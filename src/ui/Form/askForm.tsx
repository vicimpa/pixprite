import { t } from "~/core/i18n";
import { Dialog, openDialog } from "~/ui/Dialog";
import type { FormSchema, FormValues } from "@pixprite/api";
import { useState, type FC } from "react";
import { Form, formDefaults } from "./Form";

const FormAsk: FC<{ title: string; schema: FormSchema; done: (v: FormValues | null) => void; close: () => void; }> =
  ({ title, schema, done, close }) => {
    const [values, setValues] = useState(() => formDefaults(schema));
    let submitted = false;
    return (
      <Dialog title={title} submitLabel={t('common.ok')}
        onSubmit={() => { submitted = true; done(values); }}
        onClose={() => { close(); if (!submitted) done(null); }}>
        <Form schema={schema} values={values} onChange={setValues} />
      </Dialog>
    );
  };

/** A form in the app's own window; resolves its values, or null when cancelled. Labels are passed translated */
export function askForm(title: string, schema: FormSchema) {
  return new Promise<FormValues | null>(resolve => {
    let settled = false;
    const done = (v: FormValues | null) => { if (!settled) { settled = true; resolve(v); } };
    openDialog(close => <FormAsk title={title} schema={schema} done={done} close={close} />);
  });
}
