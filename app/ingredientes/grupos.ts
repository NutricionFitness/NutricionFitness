import { clienteServidor } from "@/lib/supabase/servidor";

/**
 * Los grupos que existen de verdad en el catálogo.
 *
 * Se leen de los datos y no de una lista escrita a mano: si mañana aparece uno
 * nuevo en BEDCA, o lo estrenas tú al crear un ingrediente, sale solo.
 *
 * Hasta la fase 27 esto se traía la columna `grupo` de **todas** las filas y las
 * resumía aquí, con un `limit(5000)` de red: PostgREST no sabe hacer `distinct`,
 * y quince valores sobre mil y pico filas de una sola columna salía más barato
 * que montar nada. Con el volcado de Open Food Facts dentro son 150.000 filas, y
 * ese `limit` deja de ser una red y pasa a **recortar**: los grupos deducidos de
 * las primeras 5.000 filas de 150.000 pueden no ser todos, y el desplegable
 * perdería opciones sin decirlo.
 *
 * `distinct` es lo que PostgREST no sabe hacer, no lo que PostgreSQL no sabe
 * hacer. La función `grupos_catalogo()` de la migración 0018 lo hace en la base.
 */
export async function gruposDisponibles(): Promise<string[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("grupos_catalogo");
  if (error) return [];

  return ((data ?? []) as { grupo: string }[])
    .map((f) => f.grupo)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es"));
}
