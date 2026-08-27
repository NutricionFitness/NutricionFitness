/**
 * Qué cambiar en TODA la dieta para acercarse al reparto pedido.
 *
 * El panel de una fila contesta «¿por qué cambio este alimento?». Esto contesta
 * la pregunta de antes: **¿cuál cambio?**. Es la que aparece cuando el motor
 * dice «moviendo gramos de los mismos alimentos no da más de sí», porque
 * entonces hay que sustituir algo y con doce componentes ir probando fila por
 * fila es un trabajo que puede hacer la máquina.
 *
 * ## Por qué una cadena y no un solo cambio
 *
 * Un cambio suele no bastar. Cambiar el arroz de la comida por lentejas acerca
 * siete puntos de veinte: mejor que nada, pero la pregunta era «¿cómo llego al
 * 35% de proteína?» y la respuesta sigue siendo «no llegas». Encadenando tres
 * se contesta de verdad, y se puede enseñar a dónde se llega.
 *
 * ## Voraz, y por qué basta
 *
 * En cada paso se prueban todos los componentes contra todo el catálogo y se
 * coge el que más acerca; después se da por hecho y se vuelve a empezar sobre
 * el resultado. No garantiza el óptimo —dos cambios mediocres podrían batir a
 * uno bueno seguido de otro—, pero:
 *
 *   · el óptimo exacto es combinatorio: 12 componentes × 1.090 candidatos
 *     elevado a tres pasos son 2·10¹² combinaciones,
 *   · y aquí no hace falta el óptimo, hace falta **una respuesta buena que se
 *     entienda**. Una lista de tres cambios que se leen de arriba abajo vale
 *     más que la combinación perfecta que nadie sabe por qué es la perfecta.
 *
 * Cada paso se calcula **sobre el resultado de los anteriores**, así que la
 * cadena hay que aplicarla entera y en orden: el segundo cambio mejora lo que
 * mejora porque el primero ya está hecho.
 *
 * Sin dependencias y sin tocar la base: entra lo que hay, sale lo que se
 * propone.
 */

import {
  distanciaAlObjetivo,
  rankearHaciaObjetivo,
  type Candidato,
  type Macros,
  type OpcionesSustitucion,
} from "./sustituir";

const FACTOR = { prot: 4, hc: 4, grasa: 9 } as const;

/** Un componente de la dieta, visto desde aquí. */
export interface ComponenteCambiable {
  componenteId: string;
  /** Para poder decir «el arroz de la comida» y no solo «el arroz». */
  comida: string;
  gramos: number;
  ingrediente: Candidato;
  /**
   * Si el motor no puede tocarlo, esto tampoco.
   *
   * «No tocar» y «bloqueado» significan que ese alimento se queda. Cambiar el
   * alimento entero es más gordo que moverle los gramos, así que respetarlo no
   * se discute.
   */
  movible: boolean;
}

export interface PasoDelPlan {
  componenteId: string;
  comida: string;
  actual: Candidato;
  candidato: Candidato;
  /** Gramos del sustituto: los que aportan la misma energía. */
  gramos: number;
  delta: Macros;
  /** Lo que acerca este paso, en puntos porcentuales. */
  mejora: number;
  /** El reparto de la dieta después de este paso. */
  pct: Macros;
}

export interface Plan {
  pasos: PasoDelPlan[];
  /** Distancia al reparto pedido antes y después de la cadena entera. */
  distanciaInicial: number;
  distanciaFinal: number;
  pctInicial: Macros;
  pctFinal: Macros;
  /**
   * Por qué se paró: se llegó al tope de pasos, o ya no había ningún cambio
   * que mereciera la pena. Lo lee la pantalla para decir la verdad en cada
   * caso en vez de un mensaje único.
   */
  motivo: "tope" | "sin_mas" | "nada_que_hacer";
}

export interface OpcionesPlan extends OpcionesSustitucion {
  /** Cuántos cambios encadenar como mucho. */
  maxPasos?: number;
  /** Componentes que el usuario no quiere tocar. */
  excluir?: ReadonlySet<string>;
  /**
   * Alimentos que el usuario no quiere ver propuestos, por id.
   *
   * Un plan correcto puede ser impresentable: cambiar el yogur de la cena por
   * 437 g de berberechos acerca diez puntos y no se lo come nadie. En vez de
   * intentar adivinar qué es razonable —que depende de la persona—, se deja
   * decir «berberechos no» y se vuelve a calcular sin ellos.
   */
  sinEstos?: ReadonlySet<number>;
}

const MAX_PASOS = 3;

/** El reparto en porcentaje de energía, que es como se mira. */
export function repartoPct(macros: Macros, energia: number): Macros {
  if (!(energia > 0)) return { prot: 0, hc: 0, grasa: 0 };
  return {
    prot: (100 * FACTOR.prot * macros.prot) / energia,
    hc: (100 * FACTOR.hc * macros.hc) / energia,
    grasa: (100 * FACTOR.grasa * macros.grasa) / energia,
  };
}

/**
 * Busca la cadena de cambios que más acerca al reparto pedido.
 *
 * `candidatos` llega ya filtrado por quien llama: es ahí donde se quitan los
 * alimentos que chocan con una alergia de la persona, porque eso vive en la
 * base y este fichero no la conoce.
 */
export function planDeSustitucion(
  componentes: ComponenteCambiable[],
  candidatos: Candidato[],
  macrosDieta: Macros,
  energiaDieta: number,
  objetivoPct: Partial<Macros>,
  opciones: OpcionesPlan = {},
): Plan {
  const maxPasos = opciones.maxPasos ?? MAX_PASOS;
  const excluidos = opciones.excluir ?? new Set<string>();
  const sinEstos = opciones.sinEstos ?? new Set<number>();

  // Qué alimentos hay ya en cada comida, para no proponer el que se está
  // comiendo al lado: un plato con dos veces lo mismo no es un plan, es un
  // despiste.
  const porComida = new Map<string, Set<number>>();
  for (const c of componentes) {
    const s = porComida.get(c.comida) ?? new Set<number>();
    s.add(c.ingrediente.id);
    porComida.set(c.comida, s);
  }

  const pctInicial = repartoPct(macrosDieta, energiaDieta);
  const distanciaInicial = distanciaAlObjetivo(macrosDieta, energiaDieta, objetivoPct);

  const vacio = (motivo: Plan["motivo"]): Plan => ({
    pasos: [],
    distanciaInicial,
    distanciaFinal: distanciaInicial,
    pctInicial,
    pctFinal: pctInicial,
    motivo,
  });

  if (!(energiaDieta > 0) || !Number.isFinite(distanciaInicial)) return vacio("nada_que_hacer");

  // La energía no se mueve: todas las sustituciones son isoenergéticas. Por eso
  // se puede ir acumulando solo los macros y comparar repartos paso a paso.
  let macros: Macros = { ...macrosDieta };
  const pasos: PasoDelPlan[] = [];
  const yaCambiados = new Set<string>();

  while (pasos.length < maxPasos) {
    let mejor: PasoDelPlan | null = null;

    // Repetir el mismo sustituto en dos pasos —el arroz a volador y la patata
    // también a volador— es correcto de números y ridículo de leer.
    const yaPropuestos = new Set(pasos.map((p) => p.candidato.id));

    for (const comp of componentes) {
      if (!comp.movible) continue;
      if (yaCambiados.has(comp.componenteId) || excluidos.has(comp.componenteId)) continue;

      const enSuComida = porComida.get(comp.comida);
      const lista = candidatos.filter(
        (c) => !sinEstos.has(c.id) && !yaPropuestos.has(c.id) && !enSuComida?.has(c.id),
      );

      // Se pide solo el primero: dentro de un componente, el resto de la lista
      // no aporta nada a la decisión de qué componente tocar.
      const [s] = rankearHaciaObjetivo(
        comp.ingrediente,
        comp.gramos,
        lista,
        macros,
        energiaDieta,
        objetivoPct,
        { ...opciones, limite: 1 },
      );
      if (!s?.mejora) continue;

      if (!mejor || s.mejora > mejor.mejora) {
        const despues: Macros = {
          prot: macros.prot + s.delta.prot,
          hc: macros.hc + s.delta.hc,
          grasa: macros.grasa + s.delta.grasa,
        };
        mejor = {
          componenteId: comp.componenteId,
          comida: comp.comida,
          actual: comp.ingrediente,
          candidato: s.candidato,
          gramos: s.gramos,
          delta: s.delta,
          mejora: s.mejora,
          pct: repartoPct(despues, energiaDieta),
        };
      }
    }

    if (!mejor) break;

    pasos.push(mejor);
    yaCambiados.add(mejor.componenteId);
    macros = {
      prot: macros.prot + mejor.delta.prot,
      hc: macros.hc + mejor.delta.hc,
      grasa: macros.grasa + mejor.delta.grasa,
    };
  }

  if (!pasos.length) return vacio("nada_que_hacer");

  return {
    pasos,
    distanciaInicial,
    distanciaFinal: distanciaAlObjetivo(macros, energiaDieta, objetivoPct),
    pctInicial,
    pctFinal: repartoPct(macros, energiaDieta),
    motivo: pasos.length >= maxPasos ? "tope" : "sin_mas",
  };
}
