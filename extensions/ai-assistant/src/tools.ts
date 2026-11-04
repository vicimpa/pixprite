/** OpenAI function-calling is only an adapter over the editor's shared automation API. */
import type { ExtensionContext } from '@pixprite/api';
export type ToolResult = { content: string; image?: Blob };
export function makeTools(ctx: ExtensionContext, follow: () => boolean) {
  let catalogue: ReturnType<ExtensionContext['automation']['list']> | undefined;
  return {
    async schemas() {
      catalogue ??= ctx.automation.list();
      return (await catalogue).map(({ name, description, parameters }) => ({ type: 'function' as const, function: { name, description, parameters } }));
    },
    async skills() { return ctx.automation.call('pixprite_skills'); },
    async bind(documentId: string, contextId: string) {
      return ctx.automation.call('pixprite_select', { id: documentId, contextId, follow: false });
    },
    async run(name: string, args: Record<string, unknown>, contextId: string): Promise<ToolResult> {
      const result = await ctx.automation.call<Record<string, unknown>>(name, { ...args, contextId, follow: follow() });
      const { image, ...metadata } = result;
      if (typeof image === 'string') {
        const bytes = Uint8Array.from(atob(image), char => char.charCodeAt(0));
        return { content: JSON.stringify(metadata), image: new Blob([bytes], { type: 'image/png' }) };
      }
      return { content: JSON.stringify(result) };
    },
  };
}
