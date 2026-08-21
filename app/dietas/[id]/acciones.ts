"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  rankearHaciaObjetivo,
  rankearSustitutos,
  type Candidato,
  type Macros,
  type Sustitucion,
} from "@/lib/dominio/sustituir";
import { clienteServidor } from "@/lib/supabase/servidor";

export async function actualizarComponente(
  id: string,
  cambios: Partial<{
    gramos: number; bloqueado: boolean; prioridad: number;
    min_g: number | null; max_g: number | null; paso_g: number;
  }>,
  dietaId: string,
) {
  const supabase = await clienteServidor();
  const { error } = await supabase.from("componentes").update(cambios).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${dietaId}`);
}

export async function anadirComponente(
  comidaId: string, ingredienteId: number, gramos: number, dietaId: string,
) {
  const supabase = await clienteServidor();
  const { error } = await supabase.from("componentes").insert({
    comida_id: comidaId, ingrediente_id: ingredienteId, gramos,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${dietaId}`);
}

export async function borrarComponente(id: string, dietaId: string) {
  const supabase = await clienteServidor();
  const { error } = await supabase.from("componentes").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${dietaId}`);
}

/** Guarda el ajuste como una versión nueva. La función de la base lo hace en
 *  una sola transacción: o entra todo, o no entra nada. */
export async function aplicarAjuste(datos: {
  dietaId: string;
  gramos: Array<{ id: string; gramos: number }>;
  nombre: string | null;
  kcalObjetivo: number;
  kcalOrigen: number;
  kcalFinal: number;
  modo: string;
  parametros: Record<string, unknown>;
  resultado: Record<string, unknown>;
}) {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("guardar_ajuste", {
    p_dieta_id: datos.dietaId,
    p_gramos: datos.gramos,
    p_nombre: datos.nombre,
    p_kcal_objetivo: datos.kcalObjetivo,
    p_modo: datos.modo,
    p_parametros: datos.parametros,
    p_resultado: datos.resultado,
    p_kcal_origen: datos.kcalOrigen,
    p_kcal_final: datos.kcalFinal,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/personas");
  return data as string;
}

/**
 * Cambia el ingrediente de un componente y sus gramos.
 *
 * Vale para las dos cosas que hacen eso: pasar de crudo a cocido aplicando el
 * factor de rendimiento, y sustituir un alimento por otro. En ambos casos los
 * gramos los calcula el cliente con la misma función que usó para enseñar la
 * vista previa, así que lo que se guarda es exactamente lo que se vio.
 */
export async function cambiarIngrediente(
  id: string,
  ingredienteDestino: number,
  gramosDestino: number,
  dietaId: string,
) {
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("componentes")
    .update({ ingrediente_id: ingredienteDestino, gramos: gramosDestino })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${dietaId}`);
}

/** Guarda una medida casera propia para un ingrediente. */
export async function crearMedida(
  ingredienteId: number,
  nombre: string,
  gramos: number,
  dietaId: string,
) {
  const supabase = await clienteServidor();
  const { data: usuario } = await supabase.auth.getUser();
  if (!usuario?.user) throw new Error("sin sesión");
  const { error } = await supabase.from("medidas_caseras").insert({
    ingrediente_id: ingredienteId,
    owner_id: usuario.user.id,
    nombre: nombre.trim(),
    gramos,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${dietaId}`);
}

/**
 * Busca sustitutos para un componente.
 *
 * La puntuación necesita todo el catálogo de candidatos, así que se hace en el
 * servidor: mandar mil ingredientes al navegador para elegir ocho sería tirar
 * ancho de banda. El cálculo en sí es la misma librería que se prueba aparte.
 */
export async function buscarSustitutos(datos: {
  ingredienteId: number;
  gramos: number;
  grupo: string | null;
  soloMismoGrupo: boolean;
  /** Si vienen, se buscan los cambios que más acercan al reparto pedido. */
  macrosDieta?: Macros;
  energiaDieta?: number;
  objetivoPct?: Partial<Macros>;
}): Promise<Sustitucion[]> {
  const supabase = await clienteServidor();

  const { data: actual, error: errorActual } = await supabase
    .from("ingredientes")
    .select("id, nombre, grupo, estado, prot_100, hc_100, grasa_100, kcal_100")
    .eq("id", datos.ingredienteId)
    .single();
  if (errorActual || !actual) return [];

  let consulta = supabase
    .from("ingredientes")
    .select("id, nombre, grupo, estado, prot_100, hc_100, grasa_100, kcal_100")
    .eq("preferente", true)
    .gt("kcal_100", 0)
    .neq("id", datos.ingredienteId)
    .limit(1200);
  if (datos.soloMismoGrupo && datos.grupo) consulta = consulta.eq("grupo", datos.grupo);

  const { data: filas, error } = await consulta;
  if (error || !filas) return [];

  const aCandidato = (f: (typeof filas)[number]): Candidato => ({
    id: f.id as number,
    nombre: f.nombre as string,
    grupo: f.grupo as string | null,
    estado: (f.estado as string) ?? "desconocido",
    prot: Number(f.prot_100),
    hc: Number(f.hc_100),
    grasa: Number(f.grasa_100),
    kcal100: Number(f.kcal_100),
  });

  const yo = aCandidato(actual as never);
  const candidatos = filas.map(aCandidato);

  if (datos.objetivoPct && datos.macrosDieta && datos.energiaDieta) {
    return rankearHaciaObjetivo(
      yo, datos.gramos, candidatos,
      datos.macrosDieta, datos.energiaDieta, datos.objetivoPct,
    );
  }
  return rankearSustitutos(yo, datos.gramos, candidatos);
}

// ---------------------------------------------------------------------------
// Editar y borrar
// ---------------------------------------------------------------------------

export async function actualizarDieta(
  id: string,
  cambios: Partial<{
    nombre: string;
    descripcion: string | null;
    estado_cantidades: "crudo" | "cocido" | "mixto";
    modelo_energia: "atwater" | "declarada";
    persona_id: string | null;
    archivada: boolean;
  }>,
) {
  const supabase = await clienteServidor();
  const { error } = await supabase.from("dietas").update(cambios).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${id}`);
  revalidatePath("/personas");
}

/**
 * Borra una dieta.
 *
 * Sus versiones hijas NO se van con ella: la clave apunta con `on delete set
 * null`, así que quedan como dietas independientes. Es deliberado —perder el
 * historial entero por borrar un paso intermedio sería una sorpresa muy cara— y
 * hay una prueba que lo fija.
 */
export async function borrarDieta(id: string, personaId: string | null) {
  const supabase = await clienteServidor();
  const { error } = await supabase.from("dietas").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/personas");
  redirect(personaId ? `/personas/${personaId}` : "/personas");
}

/** Copia una dieta como plantilla independiente, no como versión. */
export async function duplicarDieta(id: string, nombre?: string) {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("duplicar_dieta", {
    p_dieta_id: id,
    p_nombre: nombre ?? null,
    p_persona_id: null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/personas");
  redirect(`/dietas/${data as string}`);
}

export async function crearComida(dietaId: string, nombre: string, orden: number) {
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("comidas")
    .insert({ dieta_id: dietaId, nombre: nombre.trim(), orden });
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${dietaId}`);
}

export async function renombrarComida(id: string, nombre: string, dietaId: string) {
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("comidas").update({ nombre: nombre.trim() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${dietaId}`);
}

export async function borrarComida(id: string, dietaId: string) {
  const supabase = await clienteServidor();
  const { error } = await supabase.from("comidas").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${dietaId}`);
}

/**
 * Sube o baja un componente dentro de su comida.
 *
 * Se intercambian los `orden` de los dos vecinos en lugar de renumerar todo:
 * son dos escrituras en vez de N, y el resto de filas ni se entera.
 */
export async function moverComponente(
  id: string,
  comidaId: string,
  direccion: -1 | 1,
  dietaId: string,
) {
  const supabase = await clienteServidor();
  const { data: hermanos, error } = await supabase
    .from("componentes")
    .select("id, orden")
    .eq("comida_id", comidaId)
    .order("orden")
    .order("id");
  if (error || !hermanos) throw new Error(error?.message ?? "no se pudo leer la comida");

  const i = hermanos.findIndex((c) => c.id === id);
  const j = i + direccion;
  if (i < 0 || j < 0 || j >= hermanos.length) return; // ya está en el extremo

  // Si vienen todos con el mismo `orden` (por ejemplo 0), intercambiarlo no
  // haría nada: primero se numeran por su posición actual.
  const ordenes = hermanos.map((c, k) => (new Set(hermanos.map((h) => h.orden)).size === 1 ? k : c.orden));

  await Promise.all([
    supabase.from("componentes").update({ orden: ordenes[j] }).eq("id", hermanos[i].id),
    supabase.from("componentes").update({ orden: ordenes[i] }).eq("id", hermanos[j].id),
  ]);
  revalidatePath(`/dietas/${dietaId}`);
}
