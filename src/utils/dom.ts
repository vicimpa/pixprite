export function byId(id: string): HTMLElement | null;
export function byId(id: string, strict: true): HTMLElement;
export function byId(id: string, strict = false) {
  const elem = document.getElementById(id);

  if (!elem && strict)
    throw new Error('Can not find element by id ' + '#' + id);

  return elem;
}
