// Copies the repository's public data/ and config/ into web/public so the dev server
// and the production build serve exactly what the monitor produced. Nothing is invented:
// if data/ is empty the UI shows its "not yet run" empty states.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pub = resolve(root, "web", "public");

for (const dir of ["data", "config"]) {
  const src = resolve(root, dir);
  const dst = resolve(pub, dir);
  rmSync(dst, { recursive: true, force: true });
  if (!existsSync(src)) continue;
  mkdirSync(dst, { recursive: true });
  // Snapshots are engine-internal (large, not needed by the UI); state/ holds dedup bookkeeping.
  cpSync(src, dst, {
    recursive: true,
    filter: (p) => !/[\\/]data[\\/](snapshots|state)([\\/]|$)/.test(p),
  });
}
console.log("[sync-data] copied data/ and config/ into web/public");
