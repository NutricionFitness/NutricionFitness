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
import type { ComponenteParaPlan, PlanDeCambios } from "./tipos";
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

/**
 * Añade un ingrediente a una comida, dentro de una opción concreta.
 *
 * `opcionId` es obligatoria desde la migración 0012: un componente cuelga de
 * una opción, no de la comida. Si llega vacía —una pantalla vieja, una dieta a
 * la que le falte la migración— se usa la opción activa de esa comida en vez de
 * fallar con un error de la base que no dice nada.
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
    const { data: comida } = await supabase
      .from("comidas")
      .select("opcion_activa_id, opciones ( id, orden )")
      .eq("id", comidaId)
      .single();
    const opciones = ((comida as { opciones?: Array<{ id: string; orden: number }> } | null)
      ?.opciones ?? []).sort((a, b) => a.orden - b.orden);
    opcion =
      (comida as { opcion_activa_id?: string | null } | null)?.opcion_activa_id ??
      opciones[0]?.id ??
      null;
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
