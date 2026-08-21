"use server";

import { revalidatePath } from "next/cache";

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
