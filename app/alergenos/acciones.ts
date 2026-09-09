"use server";

import { revalidatePath } from "next/cache";

import { clienteServidor } from "@/lib/supabase/servidor";

/** Un código a partir del nombre: «Fructosa» → «fructosa». */
const aCodigo = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/**
 * Declara un alérgeno propio.
 *
 * Para lo que no está en el Anexo II y aun así hay que vigilar: fructosa,
 * piñón, castaña, histamina… Los catorce estándar no se pueden crear ni tocar:
 * son la norma, no una preferencia, y el RLS lo impide.
 */
export async function crearAlergeno(nombre: string, detalle?: string) {
  const limpio = nombre.trim();
  if (!limpio) throw new Error("Ponle un nombre al alérgeno.");

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Hay que iniciar sesión.");

  const { data, error } = await supabase
    .from("alergenos")
    .insert({
      owner_id: user.id,
      codigo: aCodigo(limpio),
      nombre: limpio,
      detalle: detalle?.trim() || null,
      estandar: false,
    })
    .select("id")
    .single();

  if (error)
    throw new Error(
      error.code === "23505" ? `Ya tienes uno llamado «${limpio}».` : error.message,
    );

  revalidatePath("/personas");
  return Number(data.id);
}

export async function asignarAlergia(personaId: string, alergenoId: number) {
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("persona_alergias")
    .upsert(
      { persona_id: personaId, alergeno_id: alergenoId },
      { onConflict: "persona_id,alergeno_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
  revalidatePath(`/personas/${personaId}`);
}

export async function quitarAlergia(personaId: string, alergenoId: number) {
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("persona_alergias")
    .delete()
    .eq("persona_id", personaId)
    .eq("alergeno_id", alergenoId);
  if (error) throw new Error(error.message);
  revalidatePath(`/personas/${personaId}`);
}

/**
 * Fija la lista de alérgenos de un ingrediente y la da por revisada.
 *
 * Lo que se guarda desde aquí va con `origen = 'manual'`, y el script de
 * derivación no lo toca: solo borra e inserta lo suyo. Si alguien quita un
 * alérgeno que había deducido el script, se queda quitado.
 */
export async function fijarAlergenosIngrediente(
  ingredienteId: number,
  alergenoIds: number[],
) {
  const supabase = await clienteServidor();

  const { error: errBorrar } = await supabase
    .from("ingrediente_alergenos")
    .delete()
    .eq("ingrediente_id", ingredienteId);
  if (errBorrar) throw new Error(errBorrar.message);

  if (alergenoIds.length) {
    const { error } = await supabase.from("ingrediente_alergenos").insert(
      alergenoIds.map((alergeno_id) => ({
        ingrediente_id: ingredienteId,
        alergeno_id,
        origen: "manual",
      })),
    );
    if (error) throw new Error(error.message);
  }

  const { data, error: errMarca } = await supabase
    .from("ingredientes")
    .update({ alergenos_revisados: true })
    .eq("id", ingredienteId)
    .select("id");
  if (errMarca) throw new Error(errMarca.message);

  // El RLS no da error cuando no te deja: filtra y devuelve cero filas.
  if (!data?.length)
    throw new Error(
      "No se ha podido guardar. Si es un ingrediente del catálogo compartido, " +
        "falta por aplicar la migración 0006 en Supabase.",
    );

  revalidatePath(`/ingredientes/${ingredienteId}`);
  revalidatePath("/ingredientes");
}

/**
 * Asigna —o quita— un alérgeno de golpe a todo lo que salga de una búsqueda.
 *
 * Existe por la fructosa. No está en el Anexo II, la lleva toda la fruta, y
 * marcarla de una en una sobre 199 frutas no lo hace nadie: se filtra el
 * catálogo por grupo «Frutas» y se asigna a lo que salga.
 *
 * El filtro se vuelve a resolver **aquí**, con las mismas reglas que la lista,
 * y no se fía de una lista de identificadores que venga del navegador: así lo
 * que se marca es exactamente lo que se estaba viendo.
 *
 * NO marca los ingredientes como revisados: añadir un alérgeno no es lo mismo
 * que haber comprobado la lista entera.
 */
export async function asignarAlergenoAFiltro(
  filtro: { q: string; grupos: string[] },
  alergenoId: number,
  quitar = false,
) {
  const supabase = await clienteServidor();

  // El filtro se resuelve y se marca en la **misma** sentencia, en la base
  // (`asignar_alergeno_a_filtro`, migración 0018). Antes se traían los ids con
  // `limit(5000)` y luego se insertaban: con 1.090 filas ese tope no se
  // alcanzaba nunca, pero desde el volcado de Open Food Facts un filtro puede
  // sacar decenas de miles y la pantalla habría dicho «hecho» habiendo marcado
  // los primeros 5.000. Un alérgeno marcado a medias es peor que no marcado:
  // el aviso rojo de la dieta se calla justo donde no debe.
  const norm = filtro.q
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

  const { data, error } = await supabase.rpc("asignar_alergeno_a_filtro", {
    p_texto: norm || null,
    p_grupos: filtro.grupos.length ? filtro.grupos : null,
    p_alergeno: alergenoId,
    p_quitar: quitar,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/ingredientes");
  return Number(data ?? 0);
}
