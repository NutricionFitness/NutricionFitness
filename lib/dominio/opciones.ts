/**
 * Cuándo dos opciones de una comida valen lo mismo.
 *
 * Es la regla que sostiene toda la fase 20. Si las opciones de una comida no
 * fueran equivalentes, «las kilocalorías de la dieta» dejarían de significar
 * nada —dependerían de qué combinación estuviera activa— y el ajuste, el
 * historial y la hoja impresa se quedarían sin suelo.
 *
 * ## Contra qué se compara
 *
 * Contra la **primera** opción de la comida, la de menor orden. No contra la
 * activa: la activa cambia según lo que se esté mirando, y una referencia que
 * se mueve no es una referencia. Al crear una comida su única opción es la
 * primera, así que la referencia es siempre «lo que había».
 *
 * ## Con cuánta manga ancha
 *
 * ±5% de kilocalorías y ±3 puntos porcentuales en cada macro. Los dos límites
 * hacen falta y miden cosas distintas: 500 kcal frente a 520 son un 4% —pasa—
 * y un desayuno de 500 kcal al 20% de proteína frente a otro de 500 kcal al 30%
 * cuadra en energía y no cuadra en nada más.
 *
 * Un punto porcentual es un 1% de la energía **de esa comida**, no del día.
 *
 * ## Por qué esto no es una restricción de la base
 *
 * Porque una opción se monta a trozos: se pone el primer alimento y con uno
 * solo no cuadra nunca. Una restricción dejaría a medias una opción imposible
 * de guardar. Se comprueba cuando está terminada, se dice en qué falla, y se
 * ofrece cuadrarla con el motor.
 */

import { totalesDe, type Totales } from "./totales";
import type { Componente, Macro, ModeloEnergia } from "@/lib/motor";

const MACROS = ["prot", "hc", "grasa"] as const;

const NOMBRE: Record<Macro, string> = {
  prot: "proteína",
  hc: "hidratos",
  grasa: "grasa",
};

export interface ToleranciaEquivalencia {
  /** Desvío admisible de la energía, en tanto por uno. 0,05 = ±5%. */
  kcalRel: number;
  /** Desvío admisible de cada macro, en puntos porcentuales de esa comida. */
  macroPuntos: number;
}

export const TOLERANCIA: ToleranciaEquivalencia = { kcalRel: 0.05, macroPuntos: 3 };

export interface Equivalencia {
  equivalente: boolean;
  referencia: Totales;
  opcion: Totales;
  /** Diferencia de energía en kcal y en % de la referencia. */
  difKcal: number;
  difKcalPct: number;
  /** Desvío de cada macro en puntos porcentuales. Positivo: la opción tiene más. */
  desvios: Array<{ macro: Macro; puntos: number }>;
  /**
   * Por qué no cuadra, en frases sueltas y en castellano. Vacío si cuadra.
   * Se construyen aquí y no en la pantalla porque son parte de la regla: quien
   * cambie la tolerancia tiene que cambiar el texto en el mismo sitio.
   */
  motivos: string[];
}

const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("es-ES");
const n0 = (v: number) => Math.round(v).toLocaleString("es-ES");

/**
 * ¿Vale esta opción lo mismo que la de referencia?
 *
 * Las dos listas son de componentes del motor, así que la energía sale del
 * mismo sitio que la de la dieta. Una opción vacía nunca es equivalente: no es
 * que se desvíe, es que no hay nada que comparar.
 */
export function compararOpcion(
  referencia: Componente[],
  opcion: Componente[],
  modeloEnergia: ModeloEnergia = "atwater",
  tol: ToleranciaEquivalencia = TOLERANCIA,
): Equivalencia {
  const r = totalesDe(referencia, modeloEnergia);
  const o = totalesDe(opcion, modeloEnergia);

  const difKcal = o.energia - r.energia;
  const difKcalPct = r.energia > 0 ? (100 * difKcal) / r.energia : 0;
  const desvios = MACROS.map((m) => ({ macro: m as Macro, puntos: o.pct[m] - r.pct[m] }));

  const motivos: string[] = [];

  if (!opcion.length) {
    motivos.push("Esta opción no tiene ningún alimento todavía.");
  } else if (!(r.energia > 0)) {
    motivos.push("La opción de referencia no aporta energía, así que no hay con qué comparar.");
  } else {
    if (Math.abs(difKcalPct) > tol.kcalRel * 100)
      motivos.push(
        `${difKcal > 0 ? "Sobran" : "Faltan"} ${n0(Math.abs(difKcal))} kcal ` +
          `(${n1(Math.abs(difKcalPct))}%, y el margen es del ${n0(tol.kcalRel * 100)}%).`,
      );

    for (const d of desvios)
      if (Math.abs(d.puntos) > tol.macroPuntos)
        motivos.push(
          `${d.puntos > 0 ? "Sobran" : "Faltan"} ${n1(Math.abs(d.puntos))} puntos de ` +
            `${NOMBRE[d.macro]} (el margen son ${n0(tol.macroPuntos)}).`,
        );
  }

  return {
    equivalente: motivos.length === 0,
    referencia: r,
    opcion: o,
    difKcal,
    difKcalPct,
    // De mayor a menor desvío: lo que más se ha ido, primero.
    desvios: desvios.sort((a, b) => Math.abs(b.puntos) - Math.abs(a.puntos)),
    motivos,
  };
}

/**
 * A qué tiene que apuntar el motor para cuadrar una opción con su referencia.
 *
 * Sale aparte porque lo usan dos sitios: el botón de «cuadrar esta opción» y el
 * ajuste de la dieta, que después de mover la combinación activa tiene que
 * llevar cada opción no activa a lo que le haya quedado a su comida. Los dos
 * hacen lo mismo —correr el motor sobre una opción sola contra unas kcal y un
 * reparto— y por eso el objetivo se calcula en un único lugar.
 */
export function objetivoParaCuadrar(referencia: Totales): {
  kcal: number;
  macrosObjetivo: Record<Macro, number>;
} {
  return {
    kcal: referencia.energia,
    // El motor quiere el reparto en tanto por uno.
    macrosObjetivo: {
      prot: referencia.pct.prot / 100,
      hc: referencia.pct.hc / 100,
      grasa: referencia.pct.grasa / 100,
    },
  };
}
