/**
 * Un correo tal y como se guarda en `personas.email` (migración 0023): sin
 * espacios alrededor y en minúsculas. Vacío es `null` —«esta persona no tiene
 * correo»—, y lo que no tiene pinta de correo también, para que quien llame
 * distinga «no ha escrito nada» de «ha escrito algo raro» mirando la entrada.
 *
 * El patrón es el mismo, a propósito flojo, que el `check` de la base: si aquí
 * se aceptara algo que allí no, el error saldría al guardar y no al teclear.
 */
export function normalizarCorreo(bruto: string | null | undefined): string | null {
  const c = (bruto ?? "").trim().toLowerCase();
  if (!c || c.length > 254) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c) ? c : null;
}
