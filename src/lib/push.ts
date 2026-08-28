import webpush from "web-push";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, appSettings, pushSubscriptions, tripAccess, trips, users } from "@/db";

/**
 * Notifications, sent by this server and nobody else.
 *
 * WHAT THIS DEPENDS ON, since it is the question worth answering before building it:
 * nothing that costs money and nothing that needs an account. Web Push works by the
 * browser handing out a URL on its vendor's push service — Google's for Chrome,
 * Mozilla's for Firefox, Apple's for Safari — and this server POSTing an encrypted
 * payload to that URL, signed with a key pair it generated itself. There is no Firebase
 * project, no API key to register, no third party that sees the contents: the payload is
 * encrypted to the browser's own key, so the push service forwards bytes it cannot read.
 *
 * The two real limits are worth stating plainly. It needs HTTPS, which this instance has.
 * And on iOS it only works for a PWA that has been added to the Home Screen — Safari
 * refuses it for a page in a tab — so iPhone users have to install it first.
 *
 * Nothing here is allowed to break a write. A notification that fails is a notification
 * nobody got; an expense that fails because a notification did would be worse.
 */

const VAPID_PUBLIC = "vapid_public_key";
const VAPID_PRIVATE = "vapid_private_key";

/**
 * The instance's key pair, generated once and kept in the database.
 *
 * In the environment it would be one more thing to set up before anything works, and
 * this app's whole shape is "start it and it runs". Regenerating would only cost every
 * browser a re-subscribe, which is why it is not worth asking anybody to manage.
 */
function keys(): { publicKey: string; privateKey: string } {
  const stored = db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, [VAPID_PUBLIC, VAPID_PRIVATE]))
    .all();

  const found = Object.fromEntries(stored.map((row) => [row.key, row.value]));
  if (found[VAPID_PUBLIC] && found[VAPID_PRIVATE]) {
    return { publicKey: found[VAPID_PUBLIC], privateKey: found[VAPID_PRIVATE] };
  }

  const generated = webpush.generateVAPIDKeys();
  db.insert(appSettings)
    .values([
      { key: VAPID_PUBLIC, value: generated.publicKey },
      { key: VAPID_PRIVATE, value: generated.privateKey },
    ])
    .onConflictDoNothing()
    .run();

  // Read back rather than trusting the insert: two requests racing on first use would
  // each generate a pair, and only one of them won.
  return keys();
}

/** The half a browser needs in order to subscribe. */
export function publicKey(): string {
  return keys().publicKey;
}

/**
 * A `mailto:` or `https:` the push service can complain to about a misbehaving sender.
 * It is part of the VAPID spec; nothing is ever sent to it by us.
 */
const subject = () => process.env.TABUP_PUSH_SUBJECT?.trim() || "mailto:tabup@localhost";

/**
 * Si un destino de notificaciones es un sitio al que se puede llamar.
 *
 * Lo que se guarda aquí acaba siendo una petición que sale de este servidor, y el
 * destino lo elige quien se suscribe. Sin este filtro, una cuenta cualquiera puede
 * apuntar la suscripción al 127.0.0.1 de esta máquina —donde viven el proveedor de
 * identidad y el resto de servicios— o a una dirección de la red interna, y hacer
 * que el servidor llame por ella. Está comprobado: apuntando a un puerto local, el
 * servidor abría la conexión.
 *
 * No se ve la respuesta (la petición es a ciegas), pero sí se distingue un puerto
 * abierto de uno cerrado por el error que devuelve, y eso ya es un mapa de la red.
 *
 * Se exige https y un nombre de máquina público. Queda fuera del alcance de esto un
 * nombre público que resuelva a una dirección privada; para cerrarlo del todo haría
 * falta comprobar la IP tras resolver y en cada reintento, que es bastante más
 * maquinaria de la que pide un servicio de este tamaño.
 */
export function pushEndpointProblem(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "not_a_url";
  }
  if (url.protocol !== "https:") return "not_https";

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // Una IP escrita a pelo no es un servicio de notificaciones de ningún navegador;
  // sí es la forma de apuntar a la máquina de al lado.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return "host_is_an_ip";

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return "host_is_local";
  }
  // Un nombre sin punto sólo se resuelve dentro de la red de esta máquina.
  if (!host.includes(".")) return "host_is_internal";

  return null;
}

export function saveSubscription(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }
): void {
  db.insert(pushSubscriptions)
    .values({
      endpoint: sub.endpoint,
      userId,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      createdAt: Date.now(),
    })
    // The same browser can be re-subscribed by a different account on it, and the row
    // must then belong to whoever is signed in now.
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, createdAt: Date.now() },
    })
    .run();
}

/**
 * Drops one browser's subscription.
 *
 * `userId` is not optional for a request: an endpoint arriving in a body is a claim about
 * somebody else's browser until it is checked against the account making it, and without
 * that check any signed-in person could turn off anybody's notifications by naming their
 * endpoint. Left unscoped it also is not idempotent in the way it looks — it silently
 * deletes a row that was never yours.
 *
 * The push service is the exception, and that is why the parameter exists at all: a 410
 * is that service saying the browser is gone, which is true regardless of whose it was.
 */
export function removeSubscription(endpoint: string, userId?: string): void {
  db.delete(pushSubscriptions)
    .where(
      userId
        ? and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId))
        : eq(pushSubscriptions.endpoint, endpoint)
    )
    .run();
}

export function isSubscribed(userId: string, endpoint: string): boolean {
  return Boolean(
    db
      .select({ endpoint: pushSubscriptions.endpoint })
      .from(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId))
      )
      .get()
  );
}

/**
 * The pieces of a notification, not a sentence.
 *
 * This server has no idea which language the person holding that browser reads — it is
 * not their session, it is a push endpoint — so it sends the parts and the service worker
 * assembles them from a table keyed on `navigator.language`. Guessing here would put
 * Spanish on an English phone about half the time.
 */
export interface Notification {
  action: "expense" | "payment" | "comment" | "joined";
  /** The group's name, which is what a notification is titled with. */
  trip: string;
  /** Who did it, as they are called in that group. */
  actor: string;
  /** What it was done to: an expense's description, two names, nothing. */
  subject: string;
  /** Where tapping it should land. Relative to the origin. */
  url: string;
}

/**
 * Sends to every browser of every listed account.
 *
 * Fire and forget by design: the caller has already saved somebody's money and must not
 * wait on, or fail because of, a push service on the other side of the internet.
 */
/**
 * Qué preferencia gobierna cada clase de aviso.
 *
 * `joined` no está y no se puede apagar: pasa una vez por grupo, nunca es ruido, y es
 * el único que la persona no provoca ella misma. Ver `users` en el esquema.
 */
const PREFERENCIA = {
  expense: users.notifyExpenses,
  payment: users.notifySettlements,
  comment: users.notifyComments,
} as const;

export function notify(userIds: string[], notification: Notification): void {
  if (userIds.length === 0) return;

  // Un interruptor único obligaba a elegir entre enterarse de todo o de nada, y lo
  // segundo es lo que acaba pasando. Se filtra por persona antes de mirar sus
  // navegadores: quien apagó esta clase de aviso no entra en la consulta.
  const columna = PREFERENCIA[notification.action as keyof typeof PREFERENCIA];
  if (columna) {
    const quieren = db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, userIds), eq(columna, true)))
      .all()
      .map((r) => r.id);
    if (quieren.length === 0) return;
    userIds = quieren;
  }

  const subs = db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds))
    .all();
  if (subs.length === 0) return;

  const { publicKey, privateKey } = keys();
  const payload = JSON.stringify(notification);

  for (const sub of subs) {
    webpush
      .sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { vapidDetails: { subject: subject(), publicKey, privateKey }, TTL: 60 * 60 * 24 }
      )
      .catch((error: { statusCode?: number }) => {
        // 404 and 410 are the push service saying that browser is gone for good. Any
        // other failure is this moment's problem, not the subscription's.
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          removeSubscription(sub.endpoint);
          return;
        }
        console.error("Push failed:", error?.statusCode ?? error);
      });
  }
}

/**
 * Everyone in a trip except whoever just acted.
 *
 * Being told about your own expense is noise, and it is the fastest way to get somebody
 * to turn notifications off for good.
 */
export function othersInTrip(tripId: string, actorId?: string): string[] {
  const owner = db
    .select({ ownerId: trips.ownerId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .get()?.ownerId;

  const granted = db
    .select({ userId: tripAccess.userId })
    .from(tripAccess)
    .where(actorId ? and(eq(tripAccess.tripId, tripId), ne(tripAccess.userId, actorId)) : eq(tripAccess.tripId, tripId))
    .all()
    .map((row) => row.userId);

  const everyone = new Set(granted);
  if (owner && owner !== actorId) everyone.add(owner);
  return [...everyone];
}
