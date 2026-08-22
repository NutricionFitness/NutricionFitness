"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clienteServidor } from "@/lib/supabase/servidor";
import type { DatosIngrediente } from "./tipos";

/** Igual que la columna `nombre_norm` de la base: minúsculas y sin tildes. */
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Lo que se manda a la base.
 *
 * `kcal_100` no está: es una columna generada por Atwater
 * (4·prot + 4·hc + 9·grasa + 7·alcohol). Mandarla sería inventarse una segunda
 * verdad para el mismo dato, y además la base la rechazaría.
 */
function aFila(d: DatosIngrediente) {
  const nombre = d.nombre.trim();
  return {
    nombre,
    nombre_norm: normalizar(nombre),
    grupo: d.grupo?.trim() || null,
    estado: d.estado,
    prot_100: d.prot_100,
    hc_100: d.hc_100,
    grasa_100: d.grasa_100,
    fibra_100: d.fibra_100,
    alcohol_100: d.alcohol_100,
    agua_100: d.agua_100,
    ags_100: d.ags_100,
    sodio_100: d.sodio_100,
    porcion_comestible: d.porcion_comestible,
    notas: d.notas?.trim() || null,
  };
}

export async function crearIngrediente(datos: DatosIngrediente) {
  if (!datos.nombre.trim()) throw new Error("El ingrediente necesita un nombre.");

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("ingredientes")
    .insert({
      ...aFila(datos),
      // Con dueño: lo ve quien lo crea y nadie más. Lo exige el RLS de inserción.
      owner_id: user.id,
      origen: "propio",
      // `preferente` es lo que mira el catálogo y el buscador. Por defecto la
      // base lo deja en false —tiene sentido para BEDCA, donde hay varias fichas
      // del mismo alimento y solo una es la buena—, pero un ingrediente escrito
      // a mano no compite con ninguna otra ficha: si no fuera preferente, se
      // guardaría y no aparecería en ninguna parte.
      preferente: true,
      revisado: true,
      editado_a_mano: true,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/ingredientes");
  redirect(`/ingredientes/${data.id}`);
}

/**
 * Corrige un ingrediente, sea tuyo o del catálogo compartido.
 *
 * Desde la migración 0006 el RLS deja tocar los de BEDCA. Se marca
 * `editado_a_mano` para que `cargar-ingredientes.mjs` no lo devuelva a su valor
 * original en la siguiente recarga.
 */
export async function actualizarIngrediente(id: number, datos: DatosIngrediente) {
  if (!datos.nombre.trim()) throw new Error("El ingrediente necesita un nombre.");

  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("ingredientes")
    .update({ ...aFila(datos), editado_a_mano: true })
    .eq("id", id)
    .select("id");

  if (error) throw new Error(error.message);

  // El RLS no da error cuando no te deja: filtra y devuelve cero filas. Sin esta
  // comprobación, un cambio que no se ha guardado se vería como guardado.
  if (!data?.length)
    throw new Error(
      "No se ha podido guardar. Si es un ingrediente del catálogo compartido, " +
        "falta por aplicar la migración 0006 en Supabase.",
    );

  revalidatePath("/ingredientes");
  revalidatePath(`/ingredientes/${id}`);
}
