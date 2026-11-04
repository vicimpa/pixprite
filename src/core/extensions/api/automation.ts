import * as z from 'zod/v4-mini';
import { toolDefinitions } from '../../automation/catalog';
import { userActivity } from '../../automation/activity';
import { fail, type Handlers } from './common';
import type { ExtensionHost } from '../Host';
import type { createAutomation } from '../../automation/execute';

const executors = new WeakMap<ExtensionHost, ReturnType<typeof createAutomation>>();
const desktopOnly = new Set(['save_file', 'open_file']);
export const automationHandlers: Handlers = {
  'automation.list': c => toolDefinitions.filter(tool => !desktopOnly.has(tool.method) && (tool.readOnly || c.host.can('sprite:write')))
    .map(tool => ({ name: tool.name, description: tool.description, parameters: z.toJSONSchema(tool.schema, { io: 'input' }), readOnly: tool.readOnly })),
  'automation.call': async (c, name, args) => {
    const tool = toolDefinitions.find(tool => tool.name === name);
    if (!tool || desktopOnly.has(tool.method)) fail('not-found', `Unknown automation tool ${String(name)}`);
    if (!tool!.readOnly && !c.host.can('sprite:write')) fail('permission', 'This tool requires sprite:write');
    let execute = executors.get(c.host);
    if (!execute) {
      execute = (await import('../../automation/execute')).createAutomation(c);
      executors.set(c.host, execute);
    }
    return execute({ method: tool!.name, params: args });
  },
  'automation.activity': () => userActivity(),
};
