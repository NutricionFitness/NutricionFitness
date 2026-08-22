import { clienteServidor } from "@/lib/supabase/servidor";

export interface Alergeno {
  id: number;
  codigo: string;
  nombre: string;
  detalle: string | null;
  estandar: boolean;
}

/** Cómo se lee un ingrediente desde el punto de vista de las alergias. */
export interface AlergenosIngrediente {
  alergenos: number[];
  revisado: boolean;
}

/**
 * El catálogo: los catorce del Anexo II más los que haya declarado el usuario.
 *
 * Los estándar primero, porque son la norma; los propios detrás, por orden.
 */
export async function catalogoAlergenos(): Promise<Alergeno[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("alergenos")
    .select("id, codigo, nombre, detalle, estandar")
    .order("estandar", { ascending: false })
    .order("nombre");

  return ((data ?? []) as Alergeno[]).map((a) => ({ ...a, id: Number(a.id) }));
}

/** Las alergias de una persona, con su nombre para poder decirlo en el aviso. */
export async function alergiasDePersona(personaId: string): Promise<Alergeno[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("persona_alergias")
    .select("alergenos ( id, codigo, nombre, detalle, estandar )")
    .eq("persona_id", personaId);

  return ((data ?? []) as unknown as { alergenos: Alergeno | null }[])
    .map((f) => f.alergenos)
    .filter((a): a is Alergeno => a !== null)
    .map((a) => ({ ...a, id: Number(a.id) }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
}

/**
 * Cuáles de estas dietas llevan algún ingrediente con alguno de esos alérgenos.
 *
 * Dos consultas y un cruce en memoria, en vez de un `join` de tres saltos que
 * PostgREST escribe fatal: se piden los componentes de las dietas por un lado y
 * los ingredientes marcados por el otro. Con 1.090 ingredientes y un puñado de
 * dietas, la lista más larga son las 349 filas de «leche».
 */
export async function dietasConAlergeno(
  dietaIds: string[],
  alergenoIds: number[],
): Promise<Set<string>> {
  if (!dietaIds.length || !alergenoIds.length) return new Set();

  const supabase = await clienteServidor();

  const [{ data: comidas }, { data: marcados }] = await Promise.all([
    supabase
      .from("comidas")
      .select("dieta_id, componentes ( ingrediente_id )")
      .in("dieta_id", dietaIds),
    supabase
      .from("ingrediente_alergenos")
      .select("ingrediente_id")
      .in("alergeno_id", alergenoIds),
  ]);

  const peligrosos = new Set(
    ((marcados ?? []) as { ingrediente_id: number }[]).map((m) => Number(m.ingrediente_id)),
  );

  const salida = new Set<string>();
  for (const c of (comidas ?? []) as unknown as {
    dieta_id: string;
    componentes: { ingrediente_id: number }[] | null;
  }[])
    if ((c.componentes ?? []).some((x) => peligrosos.has(Number(x.ingrediente_id))))
      salida.add(c.dieta_id);

  return salida;
}

/**
 * Qué alérgenos lleva cada ingrediente de una lista, y si están revisados.
 *
 * Va en una consulta aparte y no colgando de la dieta a propósito: así el tipo
 * `DietaCompleta` del dominio se queda como está y el motor no se entera de que
 * existen las alergias, que no son asunto suyo.
 */
export async function alergenosDeIngredientes(
  ids: number[],
): Promise<Record<number, AlergenosIngrediente>> {
  if (!ids.length) return {};

  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("ingredientes")
    .select("id, alergenos_revisados, ingrediente_alergenos ( alergeno_id )")
    .in("id", ids);

  const salida: Record<number, AlergenosIngrediente> = {};
  for (const f of (data ?? []) as unknown as {
    id: number;
    alergenos_revisados: boolean;
    ingrediente_alergenos: { alergeno_id: number }[] | null;
  }[])
    salida[Number(f.id)] = {
      alergenos: (f.ingrediente_alergenos ?? []).map((x) => Number(x.alergeno_id)),
      revisado: Boolean(f.alergenos_revisados),
    };

  return salida;
}
