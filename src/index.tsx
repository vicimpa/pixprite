import "$index.css";

import { App } from "$app";
import { createRoot } from "react-dom/client";

addEventListener('contextmenu', e => e.preventDefault());
addEventListener('dblclick', e => e.preventDefault());

createRoot(document.getElementById('root')!)
  .render(<App />);