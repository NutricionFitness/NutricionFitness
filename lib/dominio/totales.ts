/**
 * Totales de un trozo de dieta, y lo que pesan por kilo de persona.
 *
 * Dos cuentas pequeñas que estaban a punto de escribirse dentro de un
 * componente de React, que es donde no se pueden probar. Las dos usan el motor
 * —no una copia del motor— para que un cambio en cómo se calcula la energía no
 * deje la cabecera de una comida diciendo otra cosa que el total de la dieta.
 */

import {
  energia,
  macros,
  porcentajes,
  type Componente,
  type Dieta,
  type Macro,
  type ModeloEnergia,
} from "@/lib/motor";

export type TresMacros = Record<Macro, number>;

export interface Totales {
  /** Kilocalorías. */
  energia: number;
  /** Gramos de cada macro. */
  macros: TresMacros;
  /** El reparto, en % de la energía. */
  pct: TresMacros;
}

const VACIO: Totales = {
  energia: 0,
  macros: { prot: 0, hc: 0, grasa: 0 },
  pct: { prot: 0, hc: 0, grasa: 0 },
};

/**
 * Lo que suman unos componentes sueltos: una comida, una opción, la dieta.
 *
 * Se le pasa el `modeloEnergia` de la dieta a la que pertenecen porque con
 * `declarada` la energía sale de `kcalRef` y no de Atwater; calcular una comida
 * con un modelo y su dieta con otro daría dos cifras que no suman.
 */
export function totalesDe(
  componentes: Componente[],
  modeloEnergia: ModeloEnergia = "atwater",
): Totales {
  if (!componentes.length) return VACIO;
  const dieta: Dieta = { componentes, modeloEnergia };
  const e = energia(dieta);
  const m = macros(dieta);
  return { energia: e, macros: m, pct: porcentajes(m, e) };
}

/**
 * Gramos de cada macro por kilo de peso corporal.
 *
 * Es como se prescribe la proteína en la práctica —«1,6 g/kg»— y no se puede
 * leer del reparto en porcentaje: un 30% de proteína son 2 g/kg en una persona
 * de 100 kg y 4 g/kg en una de 50, con la misma dieta.
 *
 * Devuelve null sin peso, en vez de un cero que se leería como un dato.
 */
export function porKilo(
  macrosG: TresMacros,
  pesoKg: number | null | undefined,
): TresMacros | null {
  if (pesoKg === null || pesoKg === undefined) return null;
  if (!(pesoKg > 0) || !Number.isFinite(pesoKg)) return null;
  return {
    prot: macrosG.prot / pesoKg,
    hc: macrosG.hc / pesoKg,
    grasa: macrosG.grasa / pesoKg,
  };
}
