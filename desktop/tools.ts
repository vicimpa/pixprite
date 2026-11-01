/** Tool catalog compiled into the native HTTP server during desktop builds. */
import * as z from 'zod/v4';
import { editOperation } from './edit-schema';
export type ToolDefinition = { name: string; description: string; schema: z.ZodObject; method: string; readOnly: boolean };
export const toolDefinitions: ToolDefinition[] = [];
function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S, method: string, readOnly = false) {
  toolDefinitions.push({ name, description, schema: z.object(shape), method, readOnly });
}
const index = z.number().int().nonnegative();
const rect = z.object({ x: index, y: index, w: z.number().int().min(1).max(4096), h: z.number().int().min(1).max(4096) });
tool('pixprite_performance', 'Sample software requestAnimationFrame cadence and input/resize activity while you interact with the editor. Does not measure physical display refresh or scanout. Stops sampling automatically.', { durationMs: z.number().int().min(100).max(5000).default(2000) }, 'performance', true);
tool('pixprite_documents', 'List documents in the editor, their stable IDs and the active document.', {}, 'documents', true);
tool('pixprite_library', 'List saved library projects and folders, including projects that are not open. Omit folderId for the whole library, use null for the root, or a folder ID for its direct children. filter searches project and folder names. Project metadata excludes thumbnails.', {
  folderId: z.string().nullable().optional(), filter: z.string().default(''),
}, 'library', true);
tool('pixprite_open_project', 'Open a saved library project by ID from pixprite_library, or activate its existing tab while preserving unsaved edits.', { id: z.string() }, 'open_project');
tool('pixprite_create', 'Create and activate a new document without a dialog.', {
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
  name: z.string().max(256).default('untitled'), colorMode: z.enum(['rgb', 'indexed', 'gray']).default('rgb'),
}, 'create');
tool('pixprite_select', 'Activate a document by ID from pixprite_documents and focus the editor.', { id: z.string() }, 'select');
tool('pixprite_open', 'Open a local document or image as a new tab. Requires an absolute filesystem path.', { path: z.string() }, 'open_file');
tool('pixprite_save', 'Write the active document to .pixprite, .aseprite/.ase, or the current frame to .png. Atomic write; existing files require overwrite:true.', {
  path: z.string(), overwrite: z.boolean().default(false),
}, 'save_file');
tool('pixprite_inspect', 'Read active document metadata: dimensions, layers, frames, palette, tags, slices and active indices. Indices are zero-based.', {}, 'inspect', true);
tool('pixprite_preview', 'Return a rendered PNG image of the document, including all visible layers. Maximum rendered size 4096×4096.', {
  frame: index.optional(), scale: z.number().int().min(1).max(16).default(1),
}, 'preview', true);
tool('pixprite_pixels', 'Read or replace straight-alpha RGBA pixels on a layer/frame. data is base64 of row-major R,G,B,A bytes. A write may instead fill rect with #RRGGBB or #RRGGBBAA. Rect must fit inside the canvas, at most 1,048,576 pixels. Writes are undoable.', {
  action: z.enum(['read', 'write']), layer: index.optional(), frame: index.optional(), rect: rect.optional(),
  data: z.string().max(6_000_000).optional(), fill: z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/).optional(),
}, 'pixels');
tool('pixprite_edit', 'Apply a batch as one undo step, rolling it back on error. Each operation has a public sprite API method and positional args. layers.add:[{name,group,at}], layers.update:[index,{name,visible,locked,opacity,blend}], layers.remove:[index], layers.move:[from,to]; frames.add:[at,{copy,duration}], frames.remove:[index], frames.setDuration:[index,ms], frames.move:[from,to]; tags.add:[{name,from,to,color,direction}], tags.update:[index,patch], tags.remove:[index]; slices.add:[{name,color,keys:[{frame,x,y,w,h}]}], slices.update:[index,patch], slices.remove:[index]; palette.set:[["#rrggbb",...],{keepPixels:true}]; selection.set:[{x,y,w,h}] or [null]. Prefix every method with sprite. All indices are zero-based.', {
  label: z.string().max(256).default('MCP edit'),
  operations: z.array(editOperation).min(1).max(128),
}, 'edit');
tool('pixprite_commands', 'List available editor commands and their argument schemas. Use filter to search IDs and labels.', { filter: z.string().default('') }, 'commands', true);
tool('pixprite_run_command', 'Run an available editor command by ID. Commands with a parameter schema require args and then execute without a dialog. Use pixprite_commands to discover parameters.', {
  id: z.string(), args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}, 'command');
tool('pixprite_history', 'Undo or redo one edit on the active document.', { action: z.enum(['undo', 'redo']) }, 'history');
