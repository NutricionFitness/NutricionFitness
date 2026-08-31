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
import {
  planDeSustitucion,
  repartoPct,
  type ComponenteCambiable,
} from "@/lib/dominio/plan-sustitucion";
import { alergenosDeIngredientes, catalogoAlergenos } from "@/app/alergenos/consultas";
import type {
  ComponenteAImportar,
  ComponenteParaPlan,
  DatosPlantillas,
  DatosTransferencia,
  PersonaDestino,
  PlanDeCambios,
  PlantillaParaElegir,
} from "./tipos";
import type { FilaPlantillaComponente } from "@/lib/dominio/tipos";
import { clienteServidor } from "@/lib/supabase/servidor";
import { opcionDeComida } from "@/lib/supabase/opciones";

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

/**
 * Añade un ingrediente a una comida, dentro de una opción concreta.
 *
 * `opcionId` es obligatoria desde la migración 0012: un componente cuelga de
 * una opción, no de la comida. Si llega vacía se resuelve con
 * `opcionDeComida`, que existe por un fallo de producción: **una dieta recién
 * creada no aceptaba su primer ingrediente**. Aquí se anidaba `opciones` dentro
 * de `comidas`, que desde la 0012 es ambiguo —dos claves ajenas—, el error no
 * se miraba, y la fila entraba con `opcion_id` nulo hasta que el disparador la
 * paraba con «la opción <NULL> no existe». Era el fallo de la fase 21 en el
 * único sitio al que no llegó aquel arreglo.
 */
export async function anadirComponente(
  comidaId: string,
  ingredienteId: number,
  gramos: number,
  dietaId: string,
  opcionId?: string | null,
) {
  const supabase = await clienteServidor();

  let opcion = opcionId ?? null;
  if (!opcion) {
    const cual = await opcionDeComida(supabase, comidaId);
    if (cual.error) throw new Error(cual.error);
    opcion = cual.id;
  }

  const { error } = await supabase.from("componentes").insert({
    comida_id: comidaId, opcion_id: opcion, ingrediente_id: ingredienteId, gramos,
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

/** Las columnas con las que se construye un `Candidato`. */
const COLUMNAS_CANDIDATO =
  "id, nombre, grupo, estado, prot_100, hc_100, grasa_100, kcal_100, alergenos_revisados";

/**
 * Qué cambiar en toda la dieta para llegar al reparto pedido.
 *
 * El panel de una fila contesta «¿por qué cambio este alimento?»; esto contesta
 * la de antes: **¿cuál cambio?**. Con doce componentes, ir abriendo el panel
 * fila por fila para ver cuál mueve el reparto es trabajo de máquina.
 *
 * Aquí se hacen las tres cosas que necesitan la base —traer el catálogo, traer
 * los ingredientes que la dieta usa ahora y apartar los que chocan con una
 * alergia— y el cálculo lo hace `lib/dominio/plan-sustitucion`, que no sabe que
 * existe Supabase y se prueba aparte.
 *
 * Los ingredientes actuales se releen del servidor en vez de fiarse de lo que
 * manda la pantalla: los gramos son del usuario, pero los números de cada
 * alimento son de la base.
 */
export async function buscarPlanDeCambios(datos: {
  componentes: ComponenteParaPlan[];
  macrosDieta: Macros;
  energiaDieta: number;
  objetivoPct: Partial<Macros>;
  /** Los alérgenos de la persona de esta dieta. */
  alergenos?: number[];
  /** Componentes que el usuario ha dicho que no se toquen. */
  excluir?: string[];
  /** Alimentos que el usuario no quiere ver propuestos. */
  sinEstos?: number[];
  maxPasos?: number;
}): Promise<PlanDeCambios> {
  const pctInicial = repartoPct(datos.macrosDieta, datos.energiaDieta);
  const vacio: PlanDeCambios = {
    pasos: [],
    distanciaInicial: 0,
    distanciaFinal: 0,
    pctInicial,
    pctFinal: pctInicial,
    motivo: "nada_que_hacer",
    fueraPorAlergia: 0,
    sinRevisar: 0,
    mirados: 0,
  };
  if (!datos.componentes.length || !(datos.energiaDieta > 0)) return vacio;

  const supabase = await clienteServidor();
  const idsEnUso = [...new Set(datos.componentes.map((c) => c.ingredienteId))];
  const alergenos = datos.alergenos ?? [];

  const [catalogo, enUso, marcados] = await Promise.all([
    supabase
      .from("ingredientes")
      .select(COLUMNAS_CANDIDATO)
      .eq("preferente", true)
      .gt("kcal_100", 0)
      .limit(1200),
    supabase.from("ingredientes").select(COLUMNAS_CANDIDATO).in("id", idsEnUso),
    alergenos.length
      ? supabase
          .from("ingrediente_alergenos")
          .select("ingrediente_id")
          .in("alergeno_id", alergenos)
      : Promise.resolve({ data: [] as { ingrediente_id: number }[] }),
  ]);

  if (!catalogo.data || !enUso.data) return vacio;

  type Fila = {
    id: number; nombre: string; grupo: string | null; estado: string | null;
    prot_100: number; hc_100: number; grasa_100: number; kcal_100: number;
    alergenos_revisados: boolean | null;
  };
  const aCandidato = (f: Fila): Candidato => ({
    id: Number(f.id),
    nombre: f.nombre,
    grupo: f.grupo,
    estado: f.estado ?? "desconocido",
    prot: Number(f.prot_100),
    hc: Number(f.hc_100),
    grasa: Number(f.grasa_100),
    kcal100: Number(f.kcal_100),
  });

  const revisado = new Map<number, boolean>();
  for (const f of [...catalogo.data, ...enUso.data] as unknown as Fila[])
    revisado.set(Number(f.id), Boolean(f.alergenos_revisados));

  // Fuera de la propuesta los que chocan con una alergia declarada. No se
  // avisa de ellos: se quitan. Un sustituto que hay que descartar por alergia
  // no es una propuesta, es un susto.
  const conAlergeno = new Set(
    ((marcados.data ?? []) as { ingrediente_id: number }[]).map((f) =>
      Number(f.ingrediente_id),
    ),
  );

  const candidatosTodos = (catalogo.data as unknown as Fila[]).map(aCandidato);
  const candidatos = candidatosTodos.filter((c) => !conAlergeno.has(c.id));

  const porId = new Map<number, Candidato>();
  for (const f of enUso.data as unknown as Fila[]) porId.set(Number(f.id), aCandidato(f));

  const componentes: ComponenteCambiable[] = [];
  for (const c of datos.componentes) {
    const ing = porId.get(c.ingredienteId);
    // Un componente cuyo ingrediente no se puede leer no se propone; el resto
    // de la dieta sigue valiendo.
    if (ing) componentes.push({ ...c, ingrediente: ing });
  }

  const plan = planDeSustitucion(
    componentes,
    candidatos,
    datos.macrosDieta,
    datos.energiaDieta,
    datos.objetivoPct,
    {
      maxPasos: datos.maxPasos,
      excluir: new Set(datos.excluir ?? []),
      sinEstos: new Set(datos.sinEstos ?? []),
    },
  );

  const pasos = plan.pasos.map((p) => ({
    ...p,
    revisado: revisado.get(p.candidato.id) ?? false,
  }));

  return {
    ...plan,
    pasos,
    fueraPorAlergia: candidatosTodos.length - candidatos.length,
    sinRevisar: pasos.filter((p) => !p.revisado).length,
    mirados: componentes.filter((c) => c.movible).length,
  };
}

/**
 * Aplica la cadena de cambios, en orden.
 *
 * En orden y parando al primer fallo, para que lo que quede aplicado sea
 * siempre un **principio** de la cadena y nunca un trozo suelto. Cada paso es
 * isoenergético por sí mismo, así que media cadena deja una dieta coherente:
 * mejorada de menos, pero coherente.
 */
export async function aplicarPlan(
  cambios: Array<{ componenteId: string; ingredienteId: number; gramos: number }>,
  dietaId: string,
): Promise<{ aplicados: number; error: string | null }> {
  const supabase = await clienteServidor();
  let aplicados = 0;

  for (const c of cambios) {
    const { error } = await supabase
      .from("componentes")
      .update({ ingrediente_id: c.ingredienteId, gramos: c.gramos })
      .eq("id", c.componenteId);
    if (error) {
      revalidatePath(`/dietas/${dietaId}`);
      return { aplicados, error: error.message };
    }
    aplicados++;
  }

  revalidatePath(`/dietas/${dietaId}`);
  return { aplicados, error: null };
}

// ---------------------------------------------------------------------------
// Editar y borrar
// ---------------------------------------------------------------------------

export async function actualizarDieta(
  id: string,
  cambios: Partial<{
    nombre: string;
    descripcion: string | null;
    nota_en_hoja: boolean;
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

// ---------------------------------------------------------------------------
// Opciones dentro de una comida
//
// El cambio de opción activa se guarda: no es un estado de la pantalla, es
// parte de la dieta. Al abrirla mañana está la que dejaste puesta, y eso es lo
// que se imprime y lo que se ajusta.
// ---------------------------------------------------------------------------

/** Cambia la opción que se está viendo de una comida. */
export async function activarOpcion(comidaId: string, opcionId: string, dietaId: string) {
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("comidas")
    .update({ opcion_activa_id: opcionId })
    .eq("id", comidaId);
  if (error) throw new Error(error.message);
  revalidatePath(`/dietas/${dietaId}`);
}

/**
 * Crea una opción nueva y la deja activa.
 *
 * `copiarDe` la crea con los mismos alimentos que otra: es lo que se quiere
 * casi siempre, porque una opción nueva se hace cambiando una cosa de la que ya
 * hay, no empezando de cero. Y de paso nace equivalente, que es la regla.
 */
export async function crearOpcion(datos: {
  comidaId: string;
  nombre: string;
  copiarDe: string | null;
  dietaId: string;
}): Promise<{ id: string | null; error: string | null }> {
  const supabase = await clienteServidor();

  const { data: hermanas } = await supabase
    .from("opciones")
    .select("orden")
    .eq("comida_id", datos.comidaId)
    .order("orden", { ascending: false })
    .limit(1);
  const orden = ((hermanas?.[0]?.orden as number | undefined) ?? -1) + 1;

  const { data: creada, error } = await supabase
    .from("opciones")
    .insert({ comida_id: datos.comidaId, nombre: datos.nombre.trim(), orden })
    .select("id")
    .single();

  if (error || !creada) {
    return {
      id: null,
      error:
        error?.code === "23505"
          ? "Ya hay una opción con ese nombre en esta comida."
          : (error?.message ?? "No se ha podido crear la opción."),
    };
  }
  const nuevaId = creada.id as string;

  if (datos.copiarDe) {
    const { data: origen } = await supabase
      .from("componentes")
      .select("ingrediente_id, gramos, orden, bloqueado, prioridad, min_g, max_g, paso_g")
      .eq("opcion_id", datos.copiarDe);

    if (origen?.length) {
      const { error: errorCopia } = await supabase.from("componentes").insert(
        origen.map((c) => ({ ...c, comida_id: datos.comidaId, opcion_id: nuevaId })),
      );
      if (errorCopia) return { id: nuevaId, error: errorCopia.message };
    }
  }

  await supabase
    .from("comidas")
    .update({ opcion_activa_id: nuevaId })
    .eq("id", datos.comidaId);

  revalidatePath(`/dietas/${datos.dietaId}`);
  return { id: nuevaId, error: null };
}

export async function renombrarOpcion(
  opcionId: string,
  nombre: string,
  dietaId: string,
): Promise<{ error: string | null }> {
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("opciones")
    .update({ nombre: nombre.trim() })
    .eq("id", opcionId);
  if (error)
    return {
      error:
        error.code === "23505"
          ? "Ya hay una opción con ese nombre en esta comida."
          : error.message,
    };
  revalidatePath(`/dietas/${dietaId}`);
  return { error: null };
}

/**
 * Borra una opción con todos sus alimentos.
 *
 * La última no se puede: lo impide un disparador de la migración 0012, porque
 * una comida sin opciones no tiene dónde poner un ingrediente. Aquí se traduce
 * ese error a algo que se pueda leer.
 */
export async function borrarOpcion(
  opcionId: string,
  dietaId: string,
): Promise<{ error: string | null }> {
  const supabase = await clienteServidor();
  const { error } = await supabase.from("opciones").delete().eq("id", opcionId);
  if (error)
    return {
      error: error.message.includes("sin opciones")
        ? "Es la única opción de esta comida: para quitarla, quita la comida entera."
        : error.message,
    };
  revalidatePath(`/dietas/${dietaId}`);
  return { error: null };
}

/**
 * Guarda los gramos que ha calculado el motor para cuadrar una opción.
 *
 * El cálculo lo hace el navegador con `ajustar`, igual que el ajuste de la
 * dieta entera: aquí solo se escribe. Así no hay dos motores.
 */
export async function guardarGramos(
  gramos: Array<{ id: string; gramos: number }>,
  dietaId: string,
): Promise<{ error: string | null }> {
  const supabase = await clienteServidor();
  for (const g of gramos) {
    const { error } = await supabase
      .from("componentes")
      .update({ gramos: g.gramos })
      .eq("id", g.id);
    if (error) return { error: error.message };
  }
  revalidatePath(`/dietas/${dietaId}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Transferir una dieta a otra persona (fase 22)
// ---------------------------------------------------------------------------

/**
 * Refrescar las dos personas implicadas.
 *
 * Se revalida el patrón de ruta y no una ruta concreta porque cambian **dos**
 * pantallas —la de origen, de donde se va, y la de destino, donde aparece— y en
 * el caso del linaje pueden moverse versiones que ni siquiera se estaban
 * mirando. Revalidar solo la de origen dejaría la de destino mintiendo hasta
 * que caducara.
 */
function refrescarPersonas(dietaId: string) {
  revalidatePath("/personas");
  revalidatePath("/personas/[id]", "page");
  revalidatePath(`/dietas/${dietaId}`);
}

/**
 * Mueve la dieta a otra persona de la misma cuenta.
 *
 * `alcance`:
 *
 *  · `'linaje'` — el árbol de versiones entero, se pulse en la versión que se
 *    pulse. Es lo que se quiere casi siempre: dejar media familia en cada
 *    persona parte el historial en dos.
 *  · `'sola'` — solo esa, desgajada: sale del árbol y **sus hijas se recuelgan
 *    de su abuela**, para que no queden apuntando a una dieta que ya es de otra
 *    persona.
 *
 * Devuelve cuántas ha movido en vez de lanzar, porque el diálogo tiene que
 * poder enseñar el motivo sin cerrarse —«esa persona es de otra cuenta»,
 * «la dieta ya es de esa persona»— y una excepción aquí se lleva la pantalla
 * entera a `app/error.tsx`.
 */
export async function transferirDieta(
  dietaId: string,
  personaDestinoId: string,
  alcance: "linaje" | "sola",
): Promise<{ movidas: number; error: string | null }> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("transferir_dieta", {
    p_dieta_id: dietaId,
    p_persona_destino_id: personaDestinoId,
    p_alcance: alcance,
  });
  if (error) return { movidas: 0, error: error.message };

  refrescarPersonas(dietaId);
  return { movidas: Number(data ?? 0), error: null };
}

/**
 * Copia la dieta en otra persona; el original se queda donde está.
 *
 * Es `duplicar_dieta` con su tercer parámetro, que existe desde la fase 20 y no
 * tenía pantalla. No hace falta función nueva en la base: lo que le faltaba era
 * comprobar de quién es esa persona, y eso lo añadió la 0013.
 *
 * No redirige, a diferencia de `duplicarDieta`: aquí se está en el listado de
 * la persona de origen, y saltar a una dieta que acaba de nacer en otra persona
 * es perder el sitio. El diálogo enseña el enlace y decide quien lo pulsa.
 */
export async function copiarDietaAPersona(
  dietaId: string,
  personaDestinoId: string,
  nombre?: string,
): Promise<{ nuevaId: string | null; error: string | null }> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("duplicar_dieta", {
    p_dieta_id: dietaId,
    p_nombre: nombre?.trim() || null,
    p_persona_id: personaDestinoId,
  });
  if (error) return { nuevaId: null, error: error.message };

  refrescarPersonas(dietaId);
  return { nuevaId: (data as string) ?? null, error: null };
}

/**
 * Lo que hace falta para dibujar el diálogo de transferencia.
 *
 * Cinco consultas y un cruce en memoria, todas en la misma llamada. Las
 * alergias se cruzan para **todas** las personas candidatas a la vez: son dos
 * consultas fijas —los alérgenos de los ingredientes de la dieta, y las
 * alergias declaradas de las personas de la cuenta— en vez de una por cada vez
 * que se cambia de persona en el selector.
 *
 * Se miran los ingredientes de **todas las opciones**, no solo de la activa: la
 * dieta lleva ese alimento dentro aunque hoy esté en la alternativa que no se
 * está viendo. Es el mismo criterio que el distintivo «posible alergia» del
 * listado.
 */
export async function datosParaTransferir(dietaId: string): Promise<DatosTransferencia> {
  const supabase = await clienteServidor();

  const { data: dieta, error } = await supabase
    .from("dietas")
    .select("id, nombre, version, persona_id, dieta_padre_id")
    .eq("id", dietaId)
    .single();
  if (error || !dieta) throw new Error(error?.message ?? "No se encuentra la dieta");

  const personaId = (dieta as { persona_id: string | null }).persona_id;
  const padreId = (dieta as { dieta_padre_id: string | null }).dieta_padre_id;

  const [{ data: linaje }, { data: personas }, { data: comidas }] = await Promise.all([
    supabase.rpc("linaje_dieta", { p_dieta_id: dietaId }),
    // El RLS ya deja fuera las personas de otras cuentas: no hace falta filtrar
    // por `owner_id`, y filtrar aquí sería fiarse del cliente para algo que la
    // base ya garantiza.
    supabase.from("personas").select("id, nombre, peso_kg").order("nombre"),
    supabase.from("comidas").select("id, componentes ( ingrediente_id )").eq("dieta_id", dietaId),
  ]);

  const versiones = (linaje ?? []) as Array<{
    id: string;
    nombre: string;
    version: number;
    dieta_padre_id: string | null;
  }>;

  const candidatas = ((personas ?? []) as Array<{
    id: string;
    nombre: string;
    peso_kg: unknown;
  }>).filter((p) => p.id !== personaId);

  // --- los ingredientes de la dieta, sin repetir ----------------------------
  const ingredientes = [
    ...new Set(
      ((comidas ?? []) as unknown as Array<{ componentes: { ingrediente_id: number }[] | null }>)
        .flatMap((c) => c.componentes ?? [])
        .map((c) => Number(c.ingrediente_id)),
    ),
  ];

  const [porIngrediente, catalogo, { data: declaradas }] = await Promise.all([
    alergenosDeIngredientes(ingredientes),
    catalogoAlergenos(),
    candidatas.length
      ? supabase
          .from("persona_alergias")
          .select("persona_id, alergeno_id")
          .in("persona_id", candidatas.map((p) => p.id))
      : Promise.resolve({ data: [] as Array<{ persona_id: string; alergeno_id: number }> }),
  ]);

  const nombreAlergeno = new Map(catalogo.map((a) => [a.id, a.nombre]));

  const suyos = new Map<string, number[]>();
  for (const f of (declaradas ?? []) as Array<{ persona_id: string; alergeno_id: number }>) {
    const lista = suyos.get(f.persona_id) ?? [];
    lista.push(Number(f.alergeno_id));
    suyos.set(f.persona_id, lista);
  }

  const destinos: PersonaDestino[] = candidatas.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    pesoKg: p.peso_kg === null || p.peso_kg === undefined ? null : Number(p.peso_kg),
    choques: (suyos.get(p.id) ?? [])
      .map((idAlergeno) => ({
        alergeno: nombreAlergeno.get(idAlergeno) ?? "un alérgeno",
        ingredientes: ingredientes.filter((i) =>
          porIngrediente[i]?.alergenos.includes(idAlergeno),
        ).length,
      }))
      .filter((c) => c.ingredientes > 0)
      .sort((a, b) => b.ingredientes - a.ingredientes),
  }));

  const origen = personaId
    ? ((personas ?? []) as Array<{ id: string; nombre: string; peso_kg: unknown }>)
        .filter((p) => p.id === personaId)
        .map((p) => ({
          id: p.id,
          nombre: p.nombre,
          pesoKg: p.peso_kg === null || p.peso_kg === undefined ? null : Number(p.peso_kg),
        }))[0] ?? null
    : null;

  return {
    dietaNombre: (dieta as { nombre: string }).nombre,
    version: Number((dieta as { version: number }).version),
    origen,
    versiones: versiones.length || 1,
    hijas: versiones.filter((v) => v.dieta_padre_id === dietaId).length,
    nombrePadre: versiones.find((v) => v.id === padreId)?.nombre ?? null,
    sinRevisar: ingredientes.filter((i) => porIngrediente[i] && !porIngrediente[i].revisado).length,
    destinos,
  };
}

// ---------------------------------------------------------------------------
// Plantillas de opción (fase 23)
// ---------------------------------------------------------------------------

// Lo que necesita `aIngrediente` para poder calcular con el motor, y nada más:
// una plantilla no enseña ficha, así que no hacen falta ni las medidas caseras
// ni el código de BEDCA.
const CAMPOS_INGREDIENTE_PLANTILLA =
  "id, nombre, grupo, estado, prot_100, hc_100, grasa_100, fibra_100, alcohol_100, kcal_ref";

/**
 * Las plantillas de la cuenta, listas para elegir una.
 *
 * Vienen con sus componentes y el ingrediente dentro —una sola clave ajena
 * entre `plantillas` y `plantilla_componentes`, así que PostgREST puede anidar;
 * es la lección de la fase 21 y la fija una comprobación de la décima batería—.
 *
 * **Sin kcal.** Las calcula la pantalla con el motor, porque dependen del
 * `modelo_energia` de la dieta de destino: la misma plantilla vale distinto en
 * dos dietas y solo la de destino sabe cuál.
 *
 * El cruce con las alergias se hace aquí para **todas** las plantillas de una
 * vez, no una consulta por plantilla al pasar el ratón por encima.
 */
export async function plantillasParaImportar(dietaId: string): Promise<DatosPlantillas> {
  const supabase = await clienteServidor();

  const { data: dieta, error } = await supabase
    .from("dietas")
    .select("id, persona_id, estado_cantidades")
    .eq("id", dietaId)
    .single();
  if (error || !dieta) throw new Error(error?.message ?? "No se encuentra la dieta");

  const personaId = (dieta as { persona_id: string | null }).persona_id;

  const [{ data: filas }, { data: alergias }] = await Promise.all([
    supabase
      .from("plantillas")
      .select(
        `id, nombre, comida_sugerida, estado_cantidades, notas,
         plantilla_componentes (
           id, plantilla_id, ingrediente_id, gramos, orden, bloqueado, prioridad,
           min_g, max_g, paso_g,
           ingredientes ( ${CAMPOS_INGREDIENTE_PLANTILLA} ) )`,
      )
      .order("nombre"),
    personaId
      ? supabase.from("persona_alergias").select("alergeno_id").eq("persona_id", personaId)
      : Promise.resolve({ data: [] as Array<{ alergeno_id: number }> }),
  ]);

  const plantillas = ((filas ?? []) as unknown as Array<{
    id: string;
    nombre: string;
    comida_sugerida: string | null;
    estado_cantidades: "crudo" | "cocido" | "mixto";
    notas: string | null;
    plantilla_componentes: FilaPlantillaComponente[] | null;
  }>).map((p) => ({ ...p, plantilla_componentes: p.plantilla_componentes ?? [] }));

  const suyos = ((alergias ?? []) as Array<{ alergeno_id: number }>).map((a) =>
    Number(a.alergeno_id),
  );

  const ingredientes = [
    ...new Set(
      plantillas.flatMap((p) => p.plantilla_componentes.map((c) => Number(c.ingrediente_id))),
    ),
  ];

  const [porIngrediente, catalogo] = await Promise.all([
    alergenosDeIngredientes(ingredientes),
    suyos.length ? catalogoAlergenos() : Promise.resolve([]),
  ]);
  const nombreAlergeno = new Map(catalogo.map((a) => [a.id, a.nombre]));

  const salida: PlantillaParaElegir[] = plantillas.map((p) => {
    const ids = p.plantilla_componentes.map((c) => Number(c.ingrediente_id));
    return {
      id: p.id,
      nombre: p.nombre,
      comidaSugerida: p.comida_sugerida,
      estadoCantidades: p.estado_cantidades,
      notas: p.notas,
      componentes: p.plantilla_componentes,
      choques: suyos
        .filter((a) => ids.some((i) => porIngrediente[i]?.alergenos.includes(a)))
        .map((a) => nombreAlergeno.get(a) ?? "un alérgeno"),
      sinRevisar: ids.filter((i) => porIngrediente[i] && !porIngrediente[i].revisado).length,
    };
  });

  return {
    plantillas: salida,
    estadoDieta: (dieta as { estado_cantidades: "crudo" | "cocido" | "mixto" })
      .estado_cantidades,
    conAlergias: suyos.length > 0,
  };
}

/**
 * Guarda la opción que se está viendo como plantilla.
 *
 * Con un nombre que ya existe **no reemplaza en silencio**: el único
 * `(owner_id, nombre)` da un 23505, se devuelve `yaExiste` y la pantalla ofrece
 * reemplazarla a propósito. Es el mismo criterio que los borrados de la fase 8:
 * decir lo que va a pasar antes de que pase.
 *
 * Reemplazar **actualiza la fila**, no la borra y la vuelve a crear: así
 * `creado_en` sigue diciendo la verdad y `actualizado_en` —que pone el
 * disparador `plantillas_tocar`— dice cuándo se tocó.
 */
export async function guardarComoPlantilla(datos: {
  opcionId: string;
  nombre: string;
  comidaSugerida: string | null;
  estadoCantidades: "crudo" | "cocido" | "mixto";
  notas?: string | null;
  /** Sobrescribir la que ya se llama así. Solo cuando lo ha pedido quien mira. */
  reemplazar?: boolean;
}): Promise<{ id: string | null; error: string | null; yaExiste: boolean }> {
  const supabase = await clienteServidor();
  const nombre = datos.nombre.trim();
  if (!nombre) return { id: null, error: "La plantilla necesita un nombre.", yaExiste: false };

  const { data: origen, error: errorOrigen } = await supabase
    .from("componentes")
    .select("ingrediente_id, gramos, orden, bloqueado, prioridad, min_g, max_g, paso_g")
    .eq("opcion_id", datos.opcionId)
    .order("orden");
  if (errorOrigen) return { id: null, error: errorOrigen.message, yaExiste: false };
  if (!origen?.length)
    return {
      id: null,
      error: "Esta opción no tiene ningún alimento: no hay nada que guardar.",
      yaExiste: false,
    };

  const campos = {
    nombre,
    comida_sugerida: datos.comidaSugerida?.trim() || null,
    estado_cantidades: datos.estadoCantidades,
    notas: datos.notas?.trim() || null,
  };

  let plantillaId: string;

  if (datos.reemplazar) {
    const { data: vieja } = await supabase
      .from("plantillas")
      .select("id")
      .eq("nombre", nombre)
      .maybeSingle();
    if (!vieja) return { id: null, error: "Ya no existe esa plantilla.", yaExiste: false };

    plantillaId = vieja.id as string;
    const { error: errorUpd } = await supabase
      .from("plantillas")
      .update(campos)
      .eq("id", plantillaId);
    if (errorUpd) return { id: null, error: errorUpd.message, yaExiste: false };

    const { error: errorLimpia } = await supabase
      .from("plantilla_componentes")
      .delete()
      .eq("plantilla_id", plantillaId);
    if (errorLimpia) return { id: null, error: errorLimpia.message, yaExiste: false };
  } else {
    const { data: creada, error: errorIns } = await supabase
      .from("plantillas")
      .insert(campos)
      .select("id")
      .single();

    if (errorIns || !creada)
      return {
        id: null,
        error:
          errorIns?.code === "23505"
            ? `Ya tienes una plantilla que se llama «${nombre}».`
            : (errorIns?.message ?? "No se ha podido guardar la plantilla."),
        yaExiste: errorIns?.code === "23505",
      };
    plantillaId = creada.id as string;
  }

  const { error: errorComp } = await supabase.from("plantilla_componentes").insert(
    origen.map((c, i) => ({ ...c, plantilla_id: plantillaId, orden: c.orden ?? i })),
  );
  if (errorComp) return { id: plantillaId, error: errorComp.message, yaExiste: false };

  return { id: plantillaId, error: null, yaExiste: false };
}

/**
 * Mete una plantilla en una comida.
 *
 * Los gramos llegan **ya decididos** desde `lib/dominio/plantillas.ts`, que es
 * quien corre el motor para cuadrarla contra la referencia y quien comprueba
 * después si ha quedado cuadrada. Aquí solo se escribe.
 *
 * `opcionId` no nulo significa rellenar una opción vacía —la única que tiene una
 * comida recién creada—: se le pone el nombre de la plantilla y sus alimentos.
 * Nulo, crear una opción nueva.
 */
export async function importarPlantilla(datos: {
  comidaId: string;
  /** La opción vacía que se rellena, o null para crear una. */
  opcionId: string | null;
  nombre: string;
  componentes: ComponenteAImportar[];
  dietaId: string;
}): Promise<{ opcionId: string | null; error: string | null }> {
  const supabase = await clienteServidor();
  const nombre = datos.nombre.trim();
  if (!nombre) return { opcionId: null, error: "La opción necesita un nombre." };
  if (!datos.componentes.length)
    return { opcionId: null, error: "La plantilla no tiene ningún alimento." };

  let opcionId = datos.opcionId;

  if (opcionId) {
    const { error } = await supabase
      .from("opciones")
      .update({ nombre })
      .eq("id", opcionId);
    if (error)
      return {
        opcionId: null,
        error:
          error.code === "23505"
            ? "Ya hay una opción con ese nombre en esta comida."
            : error.message,
      };
  } else {
    const { data: hermanas } = await supabase
      .from("opciones")
      .select("orden")
      .eq("comida_id", datos.comidaId)
      .order("orden", { ascending: false })
      .limit(1);
    const orden = ((hermanas?.[0]?.orden as number | undefined) ?? -1) + 1;

    const { data: creada, error } = await supabase
      .from("opciones")
      .insert({ comida_id: datos.comidaId, nombre, orden })
      .select("id")
      .single();
    if (error || !creada)
      return {
        opcionId: null,
        error:
          error?.code === "23505"
            ? "Ya hay una opción con ese nombre en esta comida."
            : (error?.message ?? "No se ha podido crear la opción."),
      };
    opcionId = creada.id as string;
  }

  const { error: errorComp } = await supabase.from("componentes").insert(
    datos.componentes.map((c) => ({
      comida_id: datos.comidaId,
      opcion_id: opcionId,
      ingrediente_id: c.ingredienteId,
      gramos: c.gramos,
      orden: c.orden,
      bloqueado: c.bloqueado,
      prioridad: c.prioridad,
      min_g: c.minG,
      max_g: c.maxG,
      paso_g: c.pasoG,
    })),
  );
  if (errorComp) return { opcionId, error: errorComp.message };

  // Se deja puesta la que se acaba de meter: quien la importa quiere verla.
  await supabase
    .from("comidas")
    .update({ opcion_activa_id: opcionId })
    .eq("id", datos.comidaId);

  revalidatePath(`/dietas/${datos.dietaId}`);
  return { opcionId, error: null };
}

// `borrarPlantilla` vivía aquí y se ha mudado a `app/plantillas/acciones.ts`
// con el resto de lo que gestiona plantillas (fase 25). Quien la usa la importa
// de allí; dejar una copia en dos sitios es dejar que se separen.
