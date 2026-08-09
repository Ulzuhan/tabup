/**
 * Runs once, when the server starts.
 *
 * The only thing here is housekeeping — expired rows and photos nobody attached to an
 * expense. It lives in this file rather than in the database module because that one is
 * imported by everything, and a timer that starts as a side effect of an import is a
 * timer nobody can find later.
 */
export async function register() {
  // Only in the Node runtime: the edge one has no filesystem and no SQLite, and this
  // module would be dragged into a bundle it has no business being in.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startHousekeeping } = await import("@/lib/housekeeping");
  startHousekeeping();
}
