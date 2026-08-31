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
// ---------------------------------------------------------------------------
// Medidas caseras propias (fase 25)
// ---------------------------------------------------------------------------
//
// `medidas_caseras` guarda las de serie —las 472 de la fase 6, con `owner_id`
// nulo— y las de cada cuenta en la misma tabla. Desde la 0017 el dueño lo pone
// la base con `auth.uid()`: el cliente no lo manda, y el `with check` de la
// política impide ponerle otro.

/** Añade una medida casera propia a un ingrediente, sea de quien sea. */
export async function crearMedidaCasera(
  ingredienteId: number,
  nombre: string,
  gramos: number,
): Promise<{ error: string | null }> {
  const limpio = nombre.trim();
  if (!limpio) return { error: "La medida necesita un nombre: «vaso», «cazo», «unidad»…" };
  if (!(gramos > 0)) return { error: "Los gramos tienen que ser mayores que cero." };

  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("medidas_caseras")
    .insert({ ingrediente_id: ingredienteId, nombre: limpio, gramos });

  if (error)
    return {
      error:
        error.code === "23505"
          ? `Ya tienes una medida que se llama «${limpio}» para este alimento.`
          : error.message,
    };

  revalidatePath(`/ingredientes/${ingredienteId}`);
  return { error: null };
}

/**
 * Quita una medida casera **propia**.
 *
 * Las de serie no se pueden tocar y el RLS **no da error**: filtra. Por eso se
 * miran las filas devueltas —si son cero, no era tuya— en vez de dar por bueno
 * que no haya error. Es la lección de la fase 12.
 */
export async function borrarMedidaCasera(
  id: string,
  ingredienteId: number,
): Promise<{ error: string | null }> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("medidas_caseras")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length)
    return { error: "Esa medida es de serie: se puede usar, pero no quitar." };

  revalidatePath(`/ingredientes/${ingredienteId}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Borrar un ingrediente propio (fase 25)
// ---------------------------------------------------------------------------

/**
 * Dónde está usado un ingrediente.
 *
 * Se pide **al pulsar «Eliminar»**, no al pintar la ficha: son cinco consultas
 * para algo que casi nunca se hace. Y hacen falta antes de borrar porque
 * `componentes` y `plantilla_componentes` apuntan con `on delete restrict`: sin
 * este recuento, el único aviso sería un error de la base. Contar antes de que
 * se pulse es el patrón de los borrados de la fase 8.
 *
 * Cinco consultas planas y no un anidado de tres saltos, que es lo que PostgREST
 * escribe peor y lo que se comió la fase 21.
 */
export async function usosDeIngrediente(id: number): Promise<{
  dietas: Array<{ id: string; nombre: string }>;
  plantillas: Array<{ id: string; nombre: string }>;
}> {
  const supabase = await clienteServidor();

  const [{ data: comps }, { data: enPlantillas }] = await Promise.all([
    supabase.from("componentes").select("comida_id").eq("ingrediente_id", id),
    supabase.from("plantilla_componentes").select("plantilla_id").eq("ingrediente_id", id),
  ]);

  const idsComidas = [
    ...new Set(((comps ?? []) as Array<{ comida_id: string }>).map((c) => c.comida_id)),
  ];
  const idsPlantillas = [
    ...new Set(
      ((enPlantillas ?? []) as Array<{ plantilla_id: string }>).map((p) => p.plantilla_id),
    ),
  ];

  const { data: comidas } = idsComidas.length
    ? await supabase.from("comidas").select("dieta_id").in("id", idsComidas)
    : { data: [] };
  const idsDietas = [
    ...new Set(((comidas ?? []) as Array<{ dieta_id: string }>).map((m) => m.dieta_id)),
  ];

  const [{ data: dietas }, { data: plantillas }] = await Promise.all([
    idsDietas.length
      ? supabase.from("dietas").select("id, nombre").in("id", idsDietas).order("nombre")
      : Promise.resolve({ data: [] }),
    idsPlantillas.length
      ? supabase.from("plantillas").select("id, nombre").in("id", idsPlantillas).order("nombre")
      : Promise.resolve({ data: [] }),
  ]);

  return {
    dietas: (dietas ?? []) as Array<{ id: string; nombre: string }>,
    plantillas: (plantillas ?? []) as Array<{ id: string; nombre: string }>,
  };
}

/**
 * Borra un ingrediente **propio**.
 *
 * Los del catálogo compartido se pueden corregir desde la fase 12, pero no
 * borrar: están dentro de dietas guardadas de cualquiera. El RLS ya lo impide
 * —`ingredientes_borrar using (owner_id = auth.uid())`— y, como filtra en vez
 * de dar error, aquí se miran las filas devueltas: cero filas es «no era tuyo»,
 * no «hecho».
 */
export async function borrarIngrediente(id: number): Promise<{ error: string | null }> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("ingredientes")
    .delete()
    .eq("id", id)
    .select("id");

  if (error)
    return {
      error:
        error.code === "23503"
          ? "Está usado en alguna dieta o plantilla, así que no se puede borrar. " +
            "Quítalo de ahí primero."
          : error.message,
    };
  if (!data?.length)
    return {
      error:
        "No se ha borrado. Los ingredientes del catálogo compartido se pueden " +
        "corregir, pero no eliminar: están dentro de dietas ya guardadas.",
    };

  revalidatePath("/ingredientes");
  // La ficha que se estaba mirando ya no existe: quedarse en ella daría un 404
  // al primer refresco.
  redirect("/ingredientes");
}
