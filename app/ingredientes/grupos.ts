import { clienteServidor } from "@/lib/supabase/servidor";

/**
 * Los grupos que existen de verdad en el catálogo.
 *
 * Se leen de los datos y no de una lista escrita a mano: si mañana aparece uno
 * nuevo en BEDCA, o lo estrenas tú al crear un ingrediente, sale solo.
 *
 * PostgREST no sabe hacer `distinct`, así que se traen los grupos de todas las
 * filas y se resumen aquí. Son quince valores distintos sobre mil y pico filas
 * de una sola columna de texto: sale más barato que montar una vista. El `limit`
 * alto está para que un tope de filas del servidor no deje fuera el último grupo
 * por orden alfabético.
 */
export async function gruposDisponibles(): Promise<string[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("ingredientes")
    .select("grupo")
    .eq("preferente", true)
    .limit(5000);

  return [
    ...new Set(
      (data ?? [])
        .map((f) => (f.grupo as string | null) ?? "")
        .filter((g): g is string => g !== ""),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));
}
