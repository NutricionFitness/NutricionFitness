"use server";

import { revalidatePath } from "next/cache";

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
