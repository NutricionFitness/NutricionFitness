import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * En qué opción de una comida hay que meter lo que se añade.
 *
 * Existe por un fallo de producción: **una dieta recién creada no aceptaba su
 * primer ingrediente**. `anadirComponente` resolvía la opción con
 *
 * ```ts
 * .from("comidas").select("opcion_activa_id, opciones ( id, orden )")
 * ```
 *
 * y desde la 0012 hay **dos** claves ajenas entre `comidas` y `opciones`
 * —`opciones.comida_id` y `comidas.opcion_activa_id`—, así que PostgREST no
 * sabe por cuál anidar. Es exactamente el fallo de la fase 21, en el único sitio
 * al que no llegó aquel arreglo. Y encima el error de la consulta **no se
 * miraba**: se seguía con la opción a nulo, la fila entraba con `opcion_id`
 * nulo y reventaba el disparador `componente_opcion_coherente` con «la opción
 * <NULL> no existe», que es un mensaje que no le dice nada a nadie.
 *
 * Aquí va en **dos consultas planas** —el patrón de `cargarDieta` y de
 * `app/alergenos/consultas.ts`— y el error se devuelve en vez de tragárselo.
 *
 * Vive en `lib/` y no dentro de la acción para poder probarlo con un cliente de
 * mentira, que es lo único que se puede probar sin levantar PostgREST.
 */
export async function opcionDeComida(
  supabase: SupabaseClient,
  comidaId: string,
): Promise<{ id: string | null; error: string | null }> {
  const { data: comida, error } = await supabase
    .from("comidas")
    .select("opcion_activa_id")
    .eq("id", comidaId)
    .maybeSingle();

  if (error) return { id: null, error: `No se ha podido leer la comida: ${error.message}` };
  if (!comida) return { id: null, error: "Esa comida ya no existe." };

  const activa = (comida as { opcion_activa_id: string | null }).opcion_activa_id;
  if (activa) return { id: activa, error: null };

  // Sin activa marcada manda la primera, que es también la referencia con la
  // que se comparan las demás. `creado_en` e `id` desempatan, como en
  // `copiar_opciones`: dos opciones pueden compartir `orden`.
  const { data: opciones, error: errorOpciones } = await supabase
    .from("opciones")
    .select("id, orden, creado_en")
    .eq("comida_id", comidaId)
    .order("orden")
    .order("creado_en")
    .order("id")
    .limit(1);

  if (errorOpciones)
    return { id: null, error: `No se han podido leer las opciones: ${errorOpciones.message}` };

  const primera = (opciones as Array<{ id: string }> | null)?.[0]?.id ?? null;
  if (primera) return { id: primera, error: null };

  // Un disparador de la 0012 crea la primera opción al insertar la comida, así
  // que esto solo pasa si falta la migración. Decirlo es mejor que dejar que
  // reviente el `not null` de `componentes.opcion_id`.
  return {
    id: null,
    error:
      "Esta comida no tiene ninguna opción donde poner el alimento. " +
      "Puede que falte aplicar 0012_opciones_comida.sql en Supabase.",
  };
}
