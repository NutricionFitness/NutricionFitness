"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clienteServidor } from "@/lib/supabase/servidor";
import {
  filaIngrediente,
  ORIGEN_OFF,
  type AltaEscaneada,
  type DatosIngrediente,
} from "./tipos";

/**
 * Crea un ingrediente y lleva a su ficha.
 *
 * `alta` solo viene cuando el ingrediente entra por un código de barras. Lo que
 * trae —el código, la energía del envase y los alérgenos declarados— son campos
 * que el formulario no pide y que **solo** se escriben al crear: ver el
 * comentario de `AltaEscaneada`.
 */
export async function crearIngrediente(datos: DatosIngrediente, alta?: AltaEscaneada) {
  const id = await insertarIngrediente(datos, alta);
  revalidatePath("/ingredientes");
  redirect(`/ingredientes/${id}`);
}

/**
 * Lo mismo, pero devolviendo el identificador en vez de navegar.
 *
 * Existe por el escaneo desde dentro de una dieta: allí el alta es un paso
 * intermedio —lo que se quiere es añadir el alimento a la comida—, y una
 * redirección sacaría al usuario de la dieta que está montando.
 */
export async function crearIngredienteYDevolver(
  datos: DatosIngrediente,
  alta?: AltaEscaneada,
): Promise<{ id: number; nombre: string }> {
  const id = await insertarIngrediente(datos, alta);
  revalidatePath("/ingredientes");
  return { id, nombre: datos.nombre.trim() };
}

/** El insert de verdad. No exportada: `"use server"` no lo permitiría igual. */
async function insertarIngrediente(
  datos: DatosIngrediente,
  alta?: AltaEscaneada,
): Promise<number> {
  if (!datos.nombre.trim()) throw new Error("El ingrediente necesita un nombre.");

  const supabase = await clienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("ingredientes")
    .insert({
      ...filaIngrediente(datos),
      // Con dueño: lo ve quien lo crea y nadie más. Lo exige el RLS de inserción.
      owner_id: user.id,
      origen: alta ? ORIGEN_OFF : "propio",
      codigo_barras: alta?.codigo_barras ?? null,
      kcal_ref: alta?.kcal_ref ?? null,
      // `preferente` es lo que mira el catálogo y el buscador. Por defecto la
      // base lo deja en false —tiene sentido para BEDCA, donde hay varias fichas
      // del mismo alimento y solo una es la buena—, pero un ingrediente escrito
      // a mano no compite con ninguna otra ficha: si no fuera preferente, se
      // guardaría y no aparecería en ninguna parte.
      preferente: true,
      // Escrito a mano es dato revisado; traído de Open Food Facts, no. Ahí el
      // dato lo ha tecleado un desconocido a partir de una foto de la etiqueta,
      // y hasta que alguien lo mire sigue siendo eso.
      revisado: !alta,
      editado_a_mano: !alta,
    })
    .select("id")
    .single();

  if (error) {
    // Un código de barras repetido tiene arreglo y merece decirlo así.
    if (error.code === "23505" && alta)
      throw new Error(
        `Ya tienes un ingrediente con el código ${alta.codigo_barras}. Búscalo por su nombre.`,
      );
    throw new Error(error.message);
  }

  const id = Number(data.id);

  // Los alérgenos de la etiqueta, si los hay. Van con `origen = 'declarado'`,
  // que la derivación no toca: ese script solo borra lo suyo, lo 'derivado'.
  if (alta) await marcarAlergenosDeclarados(supabase, id, alta);

  return id;
}

/**
 * Marca en el ingrediente los alérgenos que declara la etiqueta.
 *
 * Las trazas se marcan igual que lo contenido. Es deliberado y es la misma
 * decisión que ya está tomada en `alergias.md`: avisar de más molesta y avisar
 * de menos hace daño. Cuáles eran trazas queda escrito en las notas.
 *
 * NO marca `alergenos_revisados`: lo dice una etiqueta, no lo ha comprobado
 * nadie, y la app distingue las dos cosas en todas las pantallas.
 */
async function marcarAlergenosDeclarados(
  supabase: Awaited<ReturnType<typeof clienteServidor>>,
  ingredienteId: number,
  alta: AltaEscaneada,
) {
  const codigos = [...new Set([...alta.alergenos, ...alta.trazas])];
  if (!codigos.length) return;

  const { data: catalogo } = await supabase
    .from("alergenos")
    .select("id, codigo")
    .is("owner_id", null)
    .in("codigo", codigos);

  const ids = ((catalogo ?? []) as { id: number; codigo: string }[]).map((a) => Number(a.id));
  if (!ids.length) return;

  // Si esto falla, el ingrediente ya está creado y es utilizable: no se tira
  // el alta por no haber podido marcar un alérgeno. La ficha los deja poner a
  // mano, y el aviso de «sin revisar» sigue puesto.
  await supabase.from("ingrediente_alergenos").upsert(
    ids.map((alergeno_id) => ({ ingrediente_id: ingredienteId, alergeno_id, origen: "declarado" })),
    { onConflict: "ingrediente_id,alergeno_id", ignoreDuplicates: true },
  );
}

/**
 * Corrige un ingrediente, sea tuyo o del catálogo compartido.
 *
 * Desde la migración 0006 el RLS deja tocar los de BEDCA. Se marca
 * `editado_a_mano` para que `cargar-ingredientes.mjs` no lo devuelva a su valor
 * original en la siguiente recarga.
 *
 * No toca `codigo_barras` ni `kcal_ref`: el formulario no los pide, y escribir
 * aquí lo que no se ha preguntado es como borrarlo.
 */
export async function actualizarIngrediente(id: number, datos: DatosIngrediente) {
  if (!datos.nombre.trim()) throw new Error("El ingrediente necesita un nombre.");

  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("ingredientes")
    .update({ ...filaIngrediente(datos), editado_a_mano: true })
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
