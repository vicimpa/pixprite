import { dispose } from "$utils/misc";
import { windowEvents } from "@vicimpa/events";
import { batch } from "@preact/signals-react";
import type { SpriteEditor } from "../SpriteEditor";


export default (self: SpriteEditor) => (
  dispose(
    windowEvents(['keydown', 'keyup'], (e) => {
      batch(() => {
        self.ctrlKey = e.ctrlKey;
        self.metaKey = e.metaKey;
        self.shiftKey = e.shiftKey;
        self.altKey = e.altKey;
      });
    }),
  )
);