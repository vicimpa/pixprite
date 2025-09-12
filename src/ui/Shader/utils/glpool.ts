import { pool } from "$utils/common";
import { RenderGL } from "$utils/render";

export const glpool = pool(() => new RenderGL());