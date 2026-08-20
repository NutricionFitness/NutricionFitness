"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clienteServidor } from "@/lib/supabase/servidor";

export async function crearPersona(datos: FormData) {
  const nombre = String(datos.get("nombre") ?? "").trim();
  if (!nombre) return;
  const supabase = await clienteServidor();
  // owner_id lo pone la base por defecto con auth.uid(), y el RLS comprueba
  // que coincide: no hace falta (ni conviene) mandarlo desde el cliente.
  const { error } = await supabase.from("personas").insert({ nombre });
  if (error) throw new Error(error.message);
  revalidatePath("/personas");
}

export async function crearDieta(datos: FormData) {
  const personaId = String(datos.get("persona_id") ?? "");
  const nombre = String(datos.get("nombre") ?? "").trim();
  if (!personaId || !nombre) return;
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("dietas")
    .insert({ persona_id: personaId, nombre })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Una dieta nueva nace con las cinco comidas del día ya puestas: crear una
  // dieta y encontrarse una pantalla vacía es un mal comienzo.
  const comidas = ["Desayuno", "Media mañana", "Comida", "Merienda", "Cena"];
  await supabase.from("comidas").insert(
    comidas.map((n, i) => ({ dieta_id: data.id, nombre: n, orden: i })),
  );
  redirect(`/dietas/${data.id}`);
}
