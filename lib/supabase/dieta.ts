import type { SupabaseClient } from "@supabase/supabase-js";

import type { DietaCompleta } from "@/lib/dominio/tipos";

/**
 * Traer una dieta entera, con sus opciones si las hay.
 *
 * ## Por qué no es un `select` anidado y ya
 *
 * Porque desde la migración 0012 hay **dos** claves ajenas entre `comidas` y
 * `opciones` —`opciones.comida_id` y `comidas.opcion_activa_id`— y PostgREST no
 * sabe cuál usar para anidar: devuelve un error de ambigüedad y se lleva por
 * delante la consulta entera. La página lo traducía a `notFound()` y salía un
 * **404 pelado** al abrir cualquier dieta, sin decir por qué.
 *
 * Así que las opciones van en consultas aparte y se cruzan en memoria. Es el
 * mismo patrón que `app/alergenos/consultas.ts` y por el mismo motivo: cuando
 * PostgREST no escribe bien un `join`, se hacen dos viajes y se cruza aquí.
 *
 * ## Y por qué se degrada en vez de fallar
 *
 * La otra causa posible del mismo 404 es que la 0012 **no esté aplicada**:
 * entonces no existen ni `componentes.opcion_id` ni `comidas.opcion_activa_id`
 * ni la tabla `opciones`, y pedirlos falla igual. Una pantalla que se cae
 * entera porque falta una migración es una pantalla frágil: aquí se intenta con
 * opciones, y si la base todavía no las tiene se vuelve a pedir sin ellas y la
 * dieta se abre como se abría antes.
 *
 * `faltaMigracion` sale a true en ese caso para poder decirlo en pantalla, que
 * es la diferencia entre «no funciona» y «te falta aplicar la 0012».
 */
export interface DietaCargada {
  dieta: DietaCompleta | null;
  /** Hubo que caer al modo sin opciones: falta la migración 0012. */
  faltaMigracion: boolean;
  /** El error de la base, si la consulta falló por otra cosa. */
  error: string | null;
}

const CAMPOS_COMPONENTE_BASE =
  "id, comida_id, ingrediente_id, gramos, orden, bloqueado, prioridad, min_g, max_g, paso_g";

export async function cargarDieta(
  supabase: SupabaseClient,
  dietaId: string,
  camposIngrediente: string,
  camposDieta = `id, owner_id, persona_id, nombre, descripcion, nota_en_hoja,
     modelo_energia, estado_cantidades, kcal_objetivo, version, dieta_padre_id,
     archivada, creado_en`,
  extra = "",
): Promise<DietaCargada> {
  const seleccion = (conOpciones: boolean) => `${camposDieta}${extra ? `,\n${extra}` : ""},
    comidas ( id, dieta_id, nombre, orden,
      componentes ( ${CAMPOS_COMPONENTE_BASE}${conOpciones ? ", opcion_id" : ""},
                    ingredientes ( ${camposIngrediente} ) ) )`;

  // Primer intento: con `opcion_id`. Si la 0012 no está, esto falla.
  let conOpciones = true;
  let { data, error } = await supabase
    .from("dietas")
    .select(seleccion(true))
    .eq("id", dietaId)
    .single();

  if (error) {
    conOpciones = false;
    ({ data, error } = await supabase
      .from("dietas")
      .select(seleccion(false))
      .eq("id", dietaId)
      .single());
    // Si también falla sin opciones, el problema es otro y hay que decirlo.
    if (error) return { dieta: null, faltaMigracion: false, error: error.message };
  }
  if (!data) return { dieta: null, faltaMigracion: false, error: null };

  const dieta = data as unknown as DietaCompleta;
  if (!conOpciones) return { dieta, faltaMigracion: true, error: null };

  // --- las opciones, en dos consultas planas -------------------------------
  const idsComidas = (dieta.comidas ?? []).map((m) => m.id);
  if (!idsComidas.length) return { dieta, faltaMigracion: false, error: null };

  const [opciones, activas] = await Promise.all([
    supabase.from("opciones").select("id, comida_id, nombre, orden").in("comida_id", idsComidas),
    supabase.from("comidas").select("id, opcion_activa_id").in("id", idsComidas),
  ]);

  // Que fallen aquí solo puede ser por la 0012: los componentes ya se leyeron.
  if (opciones.error || activas.error)
    return { dieta, faltaMigracion: true, error: null };

  const porComida = new Map<string, DietaCompleta["comidas"][number]["opciones"]>();
  for (const o of (opciones.data ?? []) as Array<{
    id: string; comida_id: string; nombre: string; orden: number;
  }>) {
    const lista = porComida.get(o.comida_id) ?? [];
    lista.push(o);
    porComida.set(o.comida_id, lista);
  }

  const activaDe = new Map(
    ((activas.data ?? []) as Array<{ id: string; opcion_activa_id: string | null }>).map((m) => [
      m.id,
      m.opcion_activa_id,
    ]),
  );

  for (const m of dieta.comidas ?? []) {
    m.opciones = porComida.get(m.id) ?? [];
    m.opcion_activa_id = activaDe.get(m.id) ?? null;
  }

  return { dieta, faltaMigracion: false, error: null };
}
