export function css(base: TemplateStringsArray, ...args: any) {
  return base.reduce((acc, item, i) => {
    return acc + item + (args[i] ?? '');
  }, '');
}