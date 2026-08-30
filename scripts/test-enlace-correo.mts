/**
 * El enlace por correo: quién puede quedarse con una cuenta que ya existía.
 *
 * POR QUÉ ESTA SUITE. TabUp es la única de las cinco herramientas que enlaza una
 * identidad nueva del proveedor con una cuenta local **por su dirección de
 * correo**. Es deliberado —es el camino de migración de las cuentas anteriores
 * al proveedor— y es también el único sitio donde el correo de otra persona se
 * podría convertir en sus viajes. Desde el 30-08 sólo ocurre si el proveedor da
 * ese correo por verificado.
 *
 * Lo que se prueba es justo lo que puede salir mal:
 *   · verificado + cuenta existente   → enlaza: la migración sigue funcionando
 *   · sin verificar + cuenta existente → NO enlaza y NO crea una segunda: falla
 *     con nombre propio. Seguir al camino de crear chocaría con el UNIQUE de
 *     `email` y el login moriría con un 500 sin explicar nada.
 *   · ya enlazado por `sub`            → ni mira el correo, que es lo que deja
 *     cambiar de dirección en el proveedor sin perder los viajes
 *   · nadie con ese correo            → crea, verificado o no: no hay nada que
 *     robarle a nadie
 *
 * Corre contra una base temporal, así que no toca datos de nadie:
 *   npm run test:enlace
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// La base ANTES de importar nada que la abra: el módulo de `db` la abre al
// importarse y crea el esquema ahí mismo.
process.env.TABUP_DB = join(mkdtempSync(join(tmpdir(), "tabup-enlace-")), "prueba.db");

const { createUser, linkOrCreateFromIdentity } = await import("../src/lib/auth.ts");
const { db, users } = await import("../src/db/index.ts");
const { eq } = await import("drizzle-orm");

let pass = 0, fail = 0;
const check = (nombre: string, real: unknown, esperado: unknown) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${ok ? "" : `  esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}`}`);
  if (ok) pass++; else fail++;
};
const uniq = () => Math.random().toString(36).slice(2, 8);
const cuentasCon = (correo: string) =>
  db.select().from(users).where(eq(users.email, correo)).all().length;

console.log("Correo verificado: la migración sigue funcionando");
{
  const correo = `heredera-${uniq()}@example.com`;
  const previa = await createUser(correo, "Heredera", "contrasena-larga", { approved: true });
  const sub = `sub-${uniq()}`;
  const tras = await linkOrCreateFromIdentity({ sub, email: correo, emailVerified: true });
  check("se queda con la cuenta que ya existía", tras.id, previa!.id);
  check("y le escribe el sub", tras.oidcSub, sub);
  check("sin duplicar la cuenta", cuentasCon(correo), 1);
}

console.log("\nCorreo SIN verificar sobre una cuenta que ya existe");
{
  const correo = `ajena-${uniq()}@example.com`;
  await createUser(correo, "Ajena", "contrasena-larga", { approved: true });
  let fallo = "";
  try {
    await linkOrCreateFromIdentity({ sub: `sub-${uniq()}`, email: correo, emailVerified: false });
  } catch (e) {
    fallo = String(e instanceof Error ? e.message : e);
  }
  check("no enlaza: falla a propósito", fallo.includes("sin verificar"), true);
  check("y NO crea una segunda cuenta con ese correo", cuentasCon(correo), 1);
  check("la cuenta ajena sigue sin sub", db.select().from(users).where(eq(users.email, correo)).get()!.oidcSub, null);
}

console.log("\nYa enlazado por sub: el correo no pinta nada");
{
  const sub = `sub-${uniq()}`;
  const primero = await linkOrCreateFromIdentity({ sub, email: `antes-${uniq()}@example.com`, emailVerified: true });
  const despues = await linkOrCreateFromIdentity({ sub, email: `despues-${uniq()}@example.com`, emailVerified: false });
  check("misma cuenta aunque cambie de dirección", despues.id, primero.id);
}

console.log("\nNadie con ese correo: se crea, verificado o no");
{
  const correo = `nadie-${uniq()}@example.com`;
  const nueva = await linkOrCreateFromIdentity({ sub: `sub-${uniq()}`, email: correo, emailVerified: false });
  check("cuenta creada", typeof nueva.id === "string" && nueva.id.length > 0, true);
  check("una sola", cuentasCon(correo), 1);
}

console.log(`\n${fail === 0 ? `todo verde (${pass} comprobaciones)` : `${fail} fallan de ${pass + fail}`}`);
process.exit(fail === 0 ? 0 : 1);
