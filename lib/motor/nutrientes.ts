/**
 * Energía y macronutrientes.
 *
 * DECISIÓN, contrastada con los 2.258 ingredientes reales de BEDCA (866 de
 * ellos traen energía declarada Y fibra, que es donde los modelos se
 * distinguen):
 *
 *     energía = 4·proteína + 4·hidratos + 9·grasa + 7·alcohol
 *     la FIBRA no aporta energía y los hidratos de BEDCA NO la incluyen
 *
 * Sobre los 115 alimentos con fibra >= 5 g/100 g, que es donde se separan las
 * convenciones, el error absoluto mediano fue 1,20% con la fórmula elegida
 * frente a 5,86% y 7,04% de las alternativas. El salvado de trigo lo zanja:
 * 21,7 g de hidratos y 42,8 g de fibra, energía declarada 189 kcal; la fórmula
 * elegida da 187,3 y sumando la fibra a 2 kcal/g daría 272,9.
 */

import {
  alcohol,
  bloqueado,
  Componente,
  Dieta,
  ErrorMotor,
  esMovil,
  fibra,
  Ingrediente,
  Macro,
  MACROS,
  ModeloEnergia,
  pasoG,
  prioridad,
} from "./modelo";

export const FACTORES: Record<string, number> = {
  prot: 4,
  hc: 4,
  grasa: 9,
  alcohol: 7,
  fibra: 0,
};

/** Energía por 100 g. */
export function kcal100(
  ing: Ingrediente,
  modelo: ModeloEnergia = "atwater",
): number {
  if (modelo === "declarada") {
    if (ing.kcalRef == null)
      throw new ErrorMotor(
        `${ing.nombre} no trae energía declarada; usa modeloEnergia "atwater"`,
      );
    return ing.kcalRef;
  }
  return (
    FACTORES.prot * ing.prot +
    FACTORES.hc * ing.hc +
    FACTORES.grasa * ing.grasa +
    FACTORES.alcohol * alcohol(ing) +
    FACTORES.fibra * fibra(ing)
  );
}

export interface Matrices {
  /** gramos actuales */
  x0: number[];
  /** macros por GRAMO de alimento, 3 x n */
  A: number[][];
  /** kcal por GRAMO de alimento */
  k: number[];
}

/**
 * A y k van por gramo, no por 100 g: así el álgebra del solver queda limpia
 * (energía = k·x, macros = A·x).
 */
export function matrices(d: Dieta): Matrices {
  const comps = d.componentes;
  const modelo = d.modeloEnergia ?? "atwater";
  const x0 = comps.map((c) => c.gramos);
  const A = [
    comps.map((c) => c.ingrediente.prot / 100),
    comps.map((c) => c.ingrediente.hc / 100),
    comps.map((c) => c.ingrediente.grasa / 100),
  ];
  const k = comps.map((c) => kcal100(c.ingrediente, modelo) / 100);
  if (k.some((v) => v < 0))
    throw new ErrorMotor("hay ingredientes con energía negativa");
  return { x0, A, k };
}

export const punto = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export function energia(d: Dieta): number {
  const { x0, k } = matrices(d);
  return punto(k, x0);
}

/** Gramos totales de cada macro. */
export function macros(d: Dieta): Record<Macro, number> {
  const { x0, A } = matrices(d);
  return {
    prot: punto(A[0], x0),
    hc: punto(A[1], x0),
    grasa: punto(A[2], x0),
  };
}

/** Reparto de la energía en % — lo que en dietética se llama «el reparto». */
export function porcentajes(
  macrosG: Record<Macro, number>,
  energiaTotal: number,
): Record<Macro, number> {
  if (energiaTotal <= 0) return { prot: 0, hc: 0, grasa: 0 };
  const out = {} as Record<Macro, number>;
  for (const m of MACROS)
    out[m] = (100 * FACTORES[m] * macrosG[m]) / energiaTotal;
  return out;
}

/** Convierte un reparto deseado en % a gramos de cada macro. */
export function gramosObjetivo(
  pct: Partial<Record<Macro, number>>,
  energiaObjetivo: number,
): Record<Macro, number> {
  const suma = Object.values(pct).reduce((a, b) => a + (b ?? 0), 0);
  const enFraccion = suma >= 0.95 && suma <= 1.05;
  const enPorciento = suma >= 95 && suma <= 105;
  if (!enFraccion && !enPorciento)
    throw new ErrorMotor(
      `el reparto de macros debe sumar 1 (o 100), suma ${suma.toFixed(3)}`,
    );
  const escala = suma > 1.5 ? 100 : 1;
  const out = {} as Record<Macro, number>;
  for (const m of MACROS)
    out[m] = ((pct[m] ?? 0) / escala) * energiaObjetivo / FACTORES[m];
  return out;
}

/** Rango permitido de cada componente, en gramos. */
export function limites(
  comps: Componente[],
  holguraRel = 0.4,
): { l: number[]; u: number[] } {
  if (holguraRel < 0) throw new ErrorMotor("holguraRel no puede ser negativa");
  const l: number[] = [];
  const u: number[] = [];
  for (const c of comps) {
    if (!esMovil(c)) {
      l.push(c.gramos);
      u.push(c.gramos);
      continue;
    }
    const lo = c.minG != null ? c.minG : Math.max(0, c.gramos * (1 - holguraRel));
    const hi = c.maxG != null ? c.maxG : c.gramos * (1 + holguraRel);
    // Los límites nunca pueden excluir el punto de partida: si lo hicieran, la
    // propia dieta original sería infactible y el motor no tendría de dónde salir.
    l.push(Math.min(lo, c.gramos));
    u.push(Math.max(hi, c.gramos));
  }
  return { l, u };
}

export { bloqueado, esMovil, pasoG, prioridad };
