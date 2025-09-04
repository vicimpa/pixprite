import { createRoot } from "react-dom/client";
import { byId } from "./utils/dom";
import { App } from "./app";

createRoot(byId('root', true))
  .render(<App />);