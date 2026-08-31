"use server";

import { revalidatePath } from "next/cache";

import { clienteServidor } from "@/lib/supabase/servidor";
import type { FilaPlantillaComponente } from "@/lib/dominio/tipos";
import type { PlantillaGuardada } from "./tipos";

// Lo que necesita `aComponentePlantilla` para calcular con el motor, y el
// nombre para poder enseñar qué lleva dentro. Ni medidas caseras ni códigos:
// esta pantalla no abre fichas.
const CAMPOS_INGREDIENTE =
  "id, nombre, grupo, estado, prot_100, hc_100, grasa_100, fibra_100, alcohol_100, kcal_ref";

/**
 * Todas las plantillas de la cuenta, con lo que llevan dentro.
 *
 * Una sola consulta con `plantilla_componentes` anidado: entre esas dos tablas
 * hay **una sola clave ajena**, así que PostgREST puede anidar. Es la lección
 * de la fase 21 y lo fija una comprobación de la décima batería.
 *
 * Sin paginar y sin buscar en el servidor: son las plantillas de una cuenta,
 * decenas como mucho, y con todas delante la búsqueda se puede hacer en la
 * pantalla —por nombre, por comida y **por lo que llevan dentro**, que es como
 * se busca una plantilla de verdad: «la que llevaba boniato»—.
 */
export async function plantillasGuardadas(): Promise<PlantillaGuardada[]> {
  const supabase = await clienteServidor();

  const { data, error } = await supabase
    .from("plantillas")
    .select(
      `id, nombre, comida_sugerida, estado_cantidades, notas, creado_en, actualizado_en,
       plantilla_componentes (
         id, plantilla_id, ingrediente_id, gramos, orden, bloqueado, prioridad,
         min_g, max_g, paso_g,
         ingredientes ( ${CAMPOS_INGREDIENTE} ) )`,
    )
    .order("nombre");

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Array<{
    id: string;
    nombre: string;
    comida_sugerida: string | null;
    estado_cantidades: "crudo" | "cocido" | "mixto";
    notas: string | null;
    creado_en: string;
    actualizado_en: string;
    plantilla_componentes: FilaPlantillaComponente[] | null;
  }>).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    comidaSugerida: p.comida_sugerida,
    estadoCantidades: p.estado_cantidades,
    notas: p.notas,
    creadoEn: p.creado_en,
    actualizadoEn: p.actualizado_en,
    componentes: (p.plantilla_componentes ?? []).sort((a, b) => a.orden - b.orden),
  }));
}

/**
 * Cambia el nombre, la comida sugerida o las notas de una plantilla.
 *
 * **No toca lo que lleva dentro.** Una plantilla es una foto: para cambiarle
 * los alimentos se importa en una dieta, se toca allí y se vuelve a guardar
 * reemplazando. Editarla aquí sería media pantalla de dieta otra vez —buscador,
 * tabla, medidas— y abriría la pregunta de qué significa una plantilla a medio
 * montar, que dentro de una comida no existe porque siempre hay una referencia
 * contra la que cuadrar.
 */
export async function actualizarPlantilla(
  id: string,
  cambios: { nombre?: string; comidaSugerida?: string | null; notas?: string | null },
): Promise<{ error: string | null }> {
  const supabase = await clienteServidor();

  const fila: Record<string, string | null> = {};
  if (cambios.nombre !== undefined) {
    const limpio = cambios.nombre.trim();
    if (!limpio) return { error: "La plantilla necesita un nombre." };
    fila.nombre = limpio;
  }
  if (cambios.comidaSugerida !== undefined)
    fila.comida_sugerida = cambios.comidaSugerida?.trim() || null;
  if (cambios.notas !== undefined) fila.notas = cambios.notas?.trim() || null;

  const { data, error } = await supabase
    .from("plantillas")
    .update(fila)
    .eq("id", id)
    .select("id");

  if (error)
    return {
      error:
        error.code === "23505"
          ? `Ya tienes otra plantilla que se llama «${fila.nombre}».`
          : error.message,
    };
  // El RLS filtra en vez de dar error: cero filas es «no es tuya», no «hecho».
  if (!data?.length) return { error: "Esa plantilla ya no existe." };

  revalidatePath("/plantillas");
  return { error: null };
}

/**
 * Quita una plantilla.
 *
 * No arrastra nada: las opciones que salieron de ella son copias que viven en
 * sus dietas. Sus componentes se van con ella (cascada).
 */
export async function borrarPlantilla(id: string): Promise<{ error: string | null }> {
  const supabase = await clienteServidor();
  const { error } = await supabase.from("plantillas").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/plantillas");
  return { error: null };
}
