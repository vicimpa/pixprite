import { SpriteEditor } from "./components/SpriteEditor";

addEventListener('contextmenu', e => {
  e.preventDefault();
});

export const App = () => {
  return (
    <SpriteEditor />
  );
};