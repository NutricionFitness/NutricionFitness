/**
 * Qué pasa al meter una plantilla en una comida.
 *
 * Aquí está la decisión entera de la fase 23, fuera de React —regla de la fase
 * 16: una pieza de lógica dentro de un `useEffect` es una pieza que no se puede
 * probar—. La pantalla se limita a preguntar y a pintar la respuesta.
 *
 * Tres cosas se deciden aquí:
 *
 *  1. **Si la plantilla rellena la opción que hay o crea una nueva.** Casi
 *     siempre crea una nueva; la excepción es la comida recién hecha, cuya
 *     única opción está vacía.
 *  2. **Con qué gramos entra.** Si la comida ya tiene referencia, se corre el
 *     motor para cuadrarla contra ella, y después se **comprueba** con
 *     `opciones.ts` que ha quedado cuadrada de verdad —no que el motor haya
 *     devuelto algo, que es distinto; es la prueba que más valió en la fase 20—.
 *  3. **Qué nombre se le pone**, para no chocar con el único
 *     `(comida_id, nombre)`.
 *
 * Y una cosa que **no** se decide: convertir crudo a cocido. Se avisa y se
 * importa tal cual, que es lo que eligió Carlos en la fase 11 para el selector
 * de crudo/cocinado.
 */

import { ajustar, type Componente, type ModeloEnergia } from "@/lib/motor";
import { compararOpcion, objetivoParaCuadrar } from "./opciones";
import { totalesDe } from "./totales";
import { aIngrediente, aNumero, aNumeroOpcional, ErrorMapeo } from "./mapeo";
import type { FilaOpcion, FilaPlantillaComponente } from "./tipos";

export type EstadoCantidades = "crudo" | "cocido" | "mixto";

/** Una fila de plantilla, traducida a lo que entiende el motor. */
export function aComponentePlantilla(
  f: FilaPlantillaComponente,
  comida: string,
): Componente {
  if (!f.ingredientes)
    throw new ErrorMapeo(`el componente ${f.id} de la plantilla llega sin su ingrediente`);
  return {
    ingrediente: aIngrediente(f.ingredientes),
    gramos: aNumero(f.gramos, "gramos"),
    comida,
    bloqueado: Boolean(f.bloqueado),
    prioridad: aNumeroOpcional(f.prioridad, "prioridad") ?? 1,
    minG: aNumeroOpcional(f.min_g, "min_g"),
    maxG: aNumeroOpcional(f.max_g, "max_g"),
    pasoG: aNumeroOpcional(f.paso_g, "paso_g") ?? 5,
  };
}

// ---------------------------------------------------------------------------
// 1. ¿Rellenar la que hay, o crear una nueva?
// ---------------------------------------------------------------------------

export type ModoImportar = "rellenar" | "nueva";

export interface Destino {
  modo: ModoImportar;
  /** La opción que se rellena. Nula cuando se va a crear una. */
  opcionId: string | null;
}

/**
 * Importar crea **siempre una opción nueva**, con una sola excepción.
 *
 * La excepción es la comida recién creada: el disparador de la 0012 le pone su
 * «Opción 1» vacía, y crear ahí una segunda opción dejaría una referencia
 * vacía **permanente** —`no_borrar_ultima_opcion` impide quitarla— contra la
 * que ninguna otra opción podría cuadrar nunca. `opciones.ts` ya trata «la
 * referencia no aporta energía» como un estado malo, y con razón.
 *
 * No se pierde nada al rellenarla, porque no había nada dentro.
 */
export function destinoDeImportacion(
  opciones: FilaOpcion[],
  componentesPorOpcion: Record<string, Componente[]>,
): Destino {
  const orden = [...opciones].sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id));
  const unica = orden.length === 1 ? orden[0] : null;

  if (unica && (componentesPorOpcion[unica.id]?.length ?? 0) === 0)
    return { modo: "rellenar", opcionId: unica.id };

  return { modo: "nueva", opcionId: null };
}

// ---------------------------------------------------------------------------
// 2. Con qué nombre entra
// ---------------------------------------------------------------------------

/**
 * Un nombre que no choque con los que ya hay en esa comida.
 *
 * `opciones` tiene un único `(comida_id, nombre)`: importar «Con tortilla» en
 * una comida que ya la tiene revienta con un 23505. Es el mismo tropiezo que el
 * «Opción 1» de la fase 20, y se resuelve igual: sufijo.
 *
 * El nombre sigue siendo editable antes de importar —quien la mete sabe mejor
 * que nadie cómo quiere llamarla—; esto es solo lo que aparece escrito de
 * partida.
 */
export function nombreLibre(base: string, usados: string[]): string {
  const limpio = base.trim() || "Opción";
  const ocupados = new Set(usados.map((u) => u.trim()));
  if (!ocupados.has(limpio)) return limpio;

  let n = 2;
  while (ocupados.has(`${limpio} (${n})`)) n++;
  return `${limpio} (${n})`;
}

// ---------------------------------------------------------------------------
// 3. Con qué gramos entra
// ---------------------------------------------------------------------------

export interface Encaje {
  /** Los componentes tal y como van a entrar, con sus gramos definitivos. */
  componentes: Componente[];
  /** ¿Ha quedado cuadrada con la referencia de la comida? */
  cuadrada: boolean;
  /** Si no cuadra, en qué falla. Las frases vienen de `opciones.ts`. */
  motivos: string[];
  /** ¿Se han movido los gramos de la plantilla para cuadrarla? */
  ajustada: boolean;
  /**
   * Por qué no se ha intentado cuadrar, cuando no se ha intentado. Nulo si se
   * intentó (haya salido o no).
   */
  sinIntentar: string | null;
}

/**
 * Los gramos con los que la plantilla entra en la comida.
 *
 * Si la comida ya tiene una referencia con energía, se corre **el mismo motor
 * que el botón de cuadrar** de la fase 20 —no un segundo cálculo «para
 * plantillas»— con las kcal y el reparto de la referencia como objetivo y
 * `holguraRel: 2`. La holgura ancha es a propósito: cuadrar una opción es mover
 * cantidades queriendo, y con el ±40% de la pantalla una plantilla que viene de
 * una dieta de 1.800 kcal no llega nunca a una comida de una de 2.400.
 *
 * Después se **comprueba** con `compararOpcion`. Que el motor devuelva
 * `factible` no quiere decir que haya cuadrado: puede llegar al total de
 * kilocalorías y dejar el reparto fuera de los tres puntos. Lo que decide es la
 * regla, no el solver.
 *
 * Si no cuadra, entra igual con lo que haya salido y la pantalla cae en el
 * estado que ya existe desde la fase 20: el aviso con el motivo escrito y el
 * botón de cuadrar. No hay nada nuevo que diseñar para eso.
 */
export function encajarPlantilla(
  plantilla: Componente[],
  /** La primera opción de la comida. Nula cuando se va a rellenar una vacía. */
  referencia: Componente[] | null,
  modeloEnergia: ModeloEnergia = "atwater",
): Encaje {
  if (!plantilla.length)
    return {
      componentes: [],
      cuadrada: false,
      motivos: ["Esta plantilla no tiene ningún alimento."],
      ajustada: false,
      sinIntentar: "la plantilla está vacía",
    };

  // Rellenar la única opción vacía: no hay con qué comparar, y la plantilla
  // pasa a ser ella misma la referencia.
  if (referencia === null)
    return {
      componentes: plantilla,
      cuadrada: true,
      motivos: [],
      ajustada: false,
      sinIntentar: "no hay referencia: esta opción pasa a serlo",
    };

  const tRef = totalesDe(referencia, modeloEnergia);

  // Sin energía de referencia no se cuadra: pedirle al motor 0 kcal mandaría
  // todos los gramos a su mínimo y **vaciaría la plantilla en silencio**, que es
  // mucho peor que entrar descuadrada y decirlo.
  if (!(tRef.energia > 0)) {
    const eq = compararOpcion(referencia, plantilla, modeloEnergia);
    return {
      componentes: plantilla,
      cuadrada: false,
      motivos: eq.motivos,
      ajustada: false,
      sinIntentar: "la opción de referencia no aporta energía",
    };
  }

  const objetivo = objetivoParaCuadrar(tRef);
  const res = ajustar({ componentes: plantilla, modeloEnergia }, objetivo.kcal, {
    modo: "prioridades",
    holguraRel: 2,
    redondear: true,
    fuerzaMacros: 600,
    macrosObjetivo: objetivo.macrosObjetivo,
  });

  // `res.dieta.componentes` sale de un `map` sobre los de entrada, así que
  // conserva el orden y todo lo demás: solo cambian los gramos.
  const salida = res.factible ? res.dieta.componentes : plantilla;
  const eq = compararOpcion(referencia, salida, modeloEnergia);

  return {
    componentes: salida,
    cuadrada: eq.equivalente,
    motivos: eq.motivos,
    ajustada: res.factible,
    sinIntentar: null,
  };
}

// ---------------------------------------------------------------------------
// 4. El aviso que no se puede resolver solo
// ---------------------------------------------------------------------------

const COMO: Record<EstadoCantidades, string> = {
  crudo: "en crudo",
  cocido: "en cocido",
  mixto: "con unos alimentos en crudo y otros en cocido",
};

/**
 * Crudo contra cocido: los gramos significan otra cosa.
 *
 * 80 g de arroz crudo son unos 200 cocidos. La app **no convierte** —solo
 * existen 25 pares de equivalencia sobre 1.090 alimentos, así que convertir
 * «lo que se pueda» dejaría una opción medio convertida, que es peor que una
 * sin convertir y avisada—. Es la misma decisión que el selector de
 * crudo/cocinado de la fase 11.
 *
 * Devuelve null cuando coinciden: un aviso que sale siempre no lo lee nadie.
 */
export function avisoEstadoCantidades(
  plantilla: EstadoCantidades,
  dieta: EstadoCantidades,
): string | null {
  if (plantilla === dieta) return null;
  return (
    `La plantilla está ${COMO[plantilla]} y esta dieta ${COMO[dieta]}: los mismos ` +
    "gramos significan cantidades distintas. Se importa tal cual, sin convertir; " +
    "revísala antes de darla por buena."
  );
}
