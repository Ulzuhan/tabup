// El standalone que escribe `next build` no incluye ni los estáticos ni `public/`,
// y en cambio puede arrastrar estado de ejecución que no pinta nada en un
// artefacto. Esto lo deja listo para `node .next/standalone/server.js`.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dirname, "..", ".next", "standalone");
for (const entry of ["data", ".env", ".env.local"]) {
  rmSync(join(root, entry), { force: true, recursive: true });
}
cpSync(join(root, "..", "static"), join(root, ".next", "static"), { recursive: true });
if (existsSync(join(root, "..", "..", "public"))) cpSync(join(root, "..", "..", "public"), join(root, "public"), { recursive: true });
