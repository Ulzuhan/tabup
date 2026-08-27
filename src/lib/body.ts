/**
 * El cuerpo de una petición, leído como objeto.
 *
 * `request.json()` falla de dos maneras distintas y las dos acababan en un 500.
 * La primera es obvia: un cuerpo que no es JSON —vacío, a medias, un formulario
 * enviado a mano— hace que `json()` lance. La segunda es más traicionera: el
 * texto `null` es JSON perfectamente válido, así que `json()` no protesta y
 * devuelve `null`; quien luego escribe `const { email } = body` se lleva un
 * TypeError. Once de las dieciocho rutas caían por una de las dos.
 *
 * Que devolviera 500 no es sólo un código equivocado. Cada 500 se anota en el
 * registro de errores del administrador, de modo que cualquiera con cuenta podía
 * llenarlo de basura y enterrar ahí los avisos que sí importan. Un cuerpo que no
 * se entiende es culpa de quien lo manda: 400.
 *
 * Se rechazan también las listas. Ninguna ruta de esta API espera una lista
 * arriba del todo, y aceptarlas sólo servía para que `body.nombre` fuese
 * `undefined` sin que nadie dijese por qué.
 *
 * El tipo de vuelta es `any` a propósito: es lo mismo que ya devolvía
 * `request.json()`, así que las rutas siguen validando campo por campo como
 * hacían. Esto arregla el fallo al leer, no sustituye a esas comprobaciones.
 */
export async function jsonBody(request: Request): Promise<any | null> {
  // Exigir `application/json` no es formalismo: es lo que cierra el CSRF entre los
  // servicios de este dominio.
  //
  // El navegador deja salir una petición a otro sitio sin preguntar antes sólo si
  // el tipo es `text/plain`, `multipart/form-data` o el de un formulario. Con
  // cualquiera de esos, una página hermana —que para el navegador es el MISMO
  // sitio, porque comparten dominio, así que la cookie viaja— podía escribir aquí
  // en nombre de quien estuviese dentro. Comprobado: con `text/plain` y un cuerpo
  // JSON, el viaje se creaba.
  //
  // Con `application/json` el navegador está obligado a preguntar primero, y esa
  // pregunta no se contesta, así que la petición no llega a salir.
  const tipo = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(tipo.trim())) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed;
}
