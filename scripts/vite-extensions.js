// Vite plugin, development only: the `extensions/` sources as the editor's catalog.
// /extensions/registry.json is made on request and the files are served as they are; a change in an
// extension (or in the API) is announced to the editor, which reinstalls what it has from here.
// The editor's build has no extensions: they are published on their own (see .github/workflows/extensions.yml).
import { execFileSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync, watch } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "extensions");
const CLI = join(ROOT, "scripts/build-extensions.ts");

/** The catalog, made by the extensions CLI (it shares the checks with `bun run ext:check`) */
function registry() {
  const out = execFileSync("bun", [CLI, "--json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return JSON.parse(out);
}

const files = dir => !existsSync(dir) ? [] : readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});

export function extensionsCatalog() {
  return {
    name: "pixprite-extensions",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/extensions/", (req, res, next) => {
        const path = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
        if (path === "registry.json") {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(registry()));
          return;
        }
        const file = join(SRC, path);
        if (path.includes("..") || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Cache-Control", "no-store");
        res.end(readFileSync(file));
      });
      // Changed extensions are announced once things settle; reads (copies) don't count
      const stamp = id => files(join(SRC, id)).map(f => { const st = statSync(f); return `${f}:${st.size}:${st.mtimeMs}`; }).join("|");
      const stamps = new Map();
      const pending = new Set();
      let timer;
      const flush = () => {
        const ids = [...pending].filter(id => { const now = existsSync(join(SRC, id)) ? stamp(id) : ""; const same = stamps.get(id) === now; stamps.set(id, now); return !same; });
        pending.clear();
        if (ids.length) server.ws.send({ type: "custom", event: "pixprite:extensions", data: { ids } });
      };
      for (const id of existsSync(SRC) ? readdirSync(SRC) : []) if (existsSync(join(SRC, id, "manifest.json"))) stamps.set(id, stamp(id));
      watch(SRC, { recursive: true }, (_e, file) => {
        const id = String(file ?? "").split(/[\\/]/)[0];
        // Only extension folders (extensions/tsconfig.json and the like are not one)
        if (!id || !existsSync(join(SRC, id, "manifest.json"))) return;
        pending.add(id);
        clearTimeout(timer);
        timer = setTimeout(flush, 200);
      });
      // The API is compiled into every extension
      watch(join(ROOT, "packages/api/src"), { recursive: true }, () => {
        for (const id of stamps.keys()) { pending.add(id); stamps.set(id, ""); }
        clearTimeout(timer);
        timer = setTimeout(flush, 200);
      });
    },
  };
}

