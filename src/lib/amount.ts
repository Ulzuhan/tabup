/**
 * Un importe, o null si no lo es.
 *
 * Antes esto era `parseFloat(String(raw))`, que se traga lo que sea y devuelve la
 * parte que entienda. El caso que importa es la coma decimal: **`"12,50"` se
 * convertía en 12**, y la respuesta era un 200 como si todo hubiera ido bien. En
 * una aplicación de dinero usada en español ése es exactamente el error que la
 * gente va a cometer, y desaparecía medio euro sin decir nada. `"100abc"` daba
 * 100 y `"1.2.3"` daba 1.2, por el mismo motivo.
 *
 * Ahora una cadena tiene que ser un número entero y completo. Se acepta la coma
 * decimal —es lo que se teclea aquí— convirtiéndola, no truncando por ella.
 *
 * Vive aquí, y no dentro de la ruta de gastos, porque quedarse allí fue el
 * verdadero fallo: se arregló para los gastos y se dejó igual en los pagos y en
 * los recurrentes. Medido después: un pago de `"12,50"` guardaba 12, uno de
 * `"12abc"` guardaba 12 tan tranquilo, y uno de `"0,99"` se rechazaba entero
 * —porque `parseFloat("0,99")` es 0 y 0 no pasa el `<= 0`—, así que pagar noventa
 * y nueve céntimos escribiendo con coma era imposible.
 */
export function parseAmount(raw: unknown): number | null {
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    const limpio = raw.trim().replace(",", ".");
    // `Number("")` es 0 y `Number("12abc")` es NaN: lo primero se descarta con el
    // `<= 0` de abajo, lo segundo aquí.
    n = Number(limpio);
  } else {
    return null;
  }
  if (!isFinite(n) || n <= 0 || n > 1e9) return null;
  return n;
}
