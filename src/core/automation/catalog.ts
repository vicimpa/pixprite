/** Tool catalog compiled into the native HTTP server during desktop builds. */
import * as z from 'zod/v4-mini';
import { editOperationInput } from './edit-schema';
import { target, pixelOperation, viewOptions, comparisonOptions } from './automation-schema';
export type ToolDefinition = {
    name: string;
    description: string;
    schema: z.ZodMiniObject;
    method: string;
    readOnly: boolean;
};
export const toolDefinitions: ToolDefinition[] = [];
function tool<S extends z.core.$ZodShape>(name: string, description: string, shape: S, method: string, readOnly = false) {
    toolDefinitions.push({ name, description, schema: z.object({ contextId: z.optional(z.string().check(z.maxLength(128))), follow: z.optional(z.boolean()), ...shape }), method, readOnly });
}
const index = z.int().check(z.minimum(0));
tool('pixprite_performance', 'Sample software requestAnimationFrame cadence and input/resize activity while you interact with the editor. Does not measure physical display refresh or scanout. Stops sampling automatically.', { durationMs: z._default(z.int().check(z.minimum(100)).check(z.maximum(5000)), 2000) }, 'performance', true);
tool('pixprite_documents', 'List documents in the editor, their stable IDs and the target document.', {}, 'documents', true);
tool('pixprite_library', 'List saved library projects and folders, including projects that are not open. Omit folderId for the whole library, use null for the root, or a folder ID for its direct children. filter searches project and folder names. Project metadata excludes thumbnails.', {
    folderId: z.optional(z.nullable(z.string())), filter: z._default(z.string(), ''),
}, 'library', true);
tool('pixprite_open_project', 'Bind a saved project from pixprite_library as a background target, preserving any existing unsaved working copy.', { id: z.string() }, 'open_project');
tool('pixprite_create', 'Create a document for the agent without switching the user tab or opening a dialog.', {
    width: z.int().check(z.minimum(1)).check(z.maximum(4096)), height: z.int().check(z.minimum(1)).check(z.maximum(4096)),
    name: z._default(z.string().check(z.maxLength(256)), 'untitled'), colorMode: z._default(z.enum(['rgb', 'indexed', 'gray']), 'rgb'),
}, 'create');
tool('pixprite_select', 'Set the agent target document by ID. Does not switch the user tab, raise the window or change OS focus.', { ...target, id: z.string() }, 'select');
tool('pixprite_open', 'Open a local document or image as a new tab. Requires an absolute filesystem path.', { path: z.string() }, 'open_file');
tool('pixprite_save', 'Write the target document to .pixprite, .aseprite/.ase, or the current frame to .png. Atomic write; existing files require overwrite:true.', {
    ...target, path: z.string(), overwrite: z._default(z.boolean(), false), applyPixelRatio: z.optional(z.boolean()),
}, 'save_file');
tool('pixprite_inspect', 'Read target document metadata, documentId, revision, playback and view state. Indices are zero-based.', { ...target }, 'inspect', true);
tool('pixprite_preview', 'Capture the current model as PNG immediately, with documentId/frame/layer/revision metadata. Includes all visible layers, or a single layer when specified. No delay after writes is needed. Maximum rendered size 4096×4096.', {
    ...target, frame: z.optional(index), layer: z.optional(index), scale: z._default(z.int().check(z.minimum(1)).check(z.maximum(16)), 1),
}, 'preview', true);
tool('pixprite_pixels', 'Read/write/fill cel rectangles on the target document. Use encoding:hex to read inspectable color rows, or rows to write up to 4096 colors (empty string ERASES). base64 RGBA supports 1,048,576 pixels. Does not alter the user selection or clipboard.', { ...target, ...pixelOperation.shape }, 'pixels');
tool('pixprite_pixels_batch', 'Read/write/fill rectangles across layers and frames of the target document atomically. One undo step for all writes, full rollback on error. Operations run in order; reads see preceding writes. At most 1,048,576 total pixels. Pin documentId and expectedRevision for safe consecutive calls.', {
    ...target, label: z._default(z.string().check(z.maxLength(256)), 'MCP pixels'), operations: z.array(pixelOperation).check(z.minLength(1)).check(z.maxLength(1024)),
}, 'pixels_batch');
tool('pixprite_playback', 'Explicit play, pause (keep current frame), or stop (rewind to frame zero). Works during playback. Returns current document/frame/revision/playing.', { ...target, action: z.enum(['play', 'pause', 'stop']) }, 'playback');
tool('pixprite_view', 'Position the editor in one call: agent frame/layer, zoom, camera center in sprite coordinates, center/fit, and onion skin. Updates only the agent cursor. The UI follows after 10 seconds of user inactivity, while the editor is focused. All indices are zero-based.', { ...target, ...viewOptions }, 'view');
tool('pixprite_selection', 'Native pixel selection clipboard and transforms. copy stores the selected fragment in this agent context\'s private clipboard; paste targets its document/layer/frame. transform moves/mirrors/quarter-turns the current selection without smoothing. Paste/transform commit as one undo step. Select frame/layer with pixprite_view first; clipboard works between documents.', {
    ...target, action: z.enum(['copy', 'paste', 'transform']), merged: z._default(z.boolean(), false),
    x: z.optional(z.int().check(z.minimum(-4096)).check(z.maximum(4096))), y: z.optional(z.int().check(z.minimum(-4096)).check(z.maximum(4096))),
    flipX: z._default(z.boolean(), false), flipY: z._default(z.boolean(), false), turns: z._default(z.int().check(z.minimum(-3)).check(z.maximum(3)), 0),
}, 'selection');
tool('pixprite_compare', 'Render equal-scale contact sheets with references and alignment guides. With show:true creates a separate read-only canvas tab with checkerboard background; does not interrupt the user. Returns PNG, source revisions and viewerId. Refresh by calling again.', { ...comparisonOptions.shape }, 'compare', true);
tool('pixprite_get_selection', 'Read the agent selection, its bounds and small mask. Pixel writes ignore this mask; selection transforms use it.', { ...target }, 'get_selection', true);
tool('pixprite_analyze', 'Measure nontransparent bounds, occupied pixels, centroid and common RGBA colors across requested cels. Useful for pose anchors, palette audits and empty-frame detection. Reports measurements, not semantic character recognition.', { ...target, layers: z.optional(z.array(index).check(z.maxLength(128))), frames: z.optional(z.array(index).check(z.maxLength(1024))) }, 'analyze', true);
tool('pixprite_skills', 'List shared task guides for inspection, drawing, editing, animation and comparison. Read only the relevant guide with pixprite_read_skill.', {}, 'skills', true);
tool('pixprite_read_skill', 'Read a shared Pixprite task guide before undertaking that task.', { name: z.string() }, 'read_skill', true);
tool('pixprite_edit', 'Apply a batch to the agent target as one undo step, rolling it back on error. Each operation has a public sprite API method and positional args. layers.add:[{name,group,at}], layers.update:[index,{name,visible,locked,opacity,blend}], layers.remove:[index], layers.move:[from,to]; frames.add:[at,{copy,duration}], frames.remove:[index], frames.setDuration:[index,ms], frames.move:[from,to]; tags.add:[{name,from,to,color,direction}], tags.update:[index,patch], tags.remove:[index]; slices.add:[{name,color,keys:[{frame,x,y,w,h}]}], slices.update:[index,patch], slices.remove:[index]; palette.set:[["#rrggbb",...],{keepPixels:true}]; selection.set:[{x,y,w,h}] or [null]. Prefix every method with sprite. All indices are zero-based.', {
    ...target, label: z._default(z.string().check(z.maxLength(256)), 'MCP edit'),
    operations: z.array(editOperationInput).check(z.minLength(1)).check(z.maxLength(128)),
}, 'edit');
tool('pixprite_commands', 'List document-safe commands and their argument schemas, including file.save to the library. Excludes modal dialogs, clipboard, native file dialogs and extension commands. Use filter to search IDs and labels.', { filter: z._default(z.string(), '') }, 'commands', true);
tool('pixprite_run_command', 'Run an available editor command by ID. Commands with a parameter schema require args and then execute without a dialog. Use pixprite_commands to discover parameters.', {
    ...target, id: z.string(), args: z.optional(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
}, 'command');
tool('pixprite_history', 'Undo or redo one edit on the target document.', { ...target, action: z.enum(['undo', 'redo']) }, 'history');
