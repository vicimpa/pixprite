import { createRoot } from "react-dom/client";
import { byId } from "$utils/dom";
import { App } from "$app";

addEventListener('contextmenu', e => {
  e.preventDefault();
});

createRoot(byId('root', true))
  .render(<App />);