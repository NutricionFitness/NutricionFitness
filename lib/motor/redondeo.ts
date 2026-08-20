/**
 * Redondeo a cantidades que se puedan pesar.
 *
 * Un óptimo continuo de 78,3 g de arroz no sirve en una cocina. Pero redondear
 * a lo bruto rompe el cierre energético, y un redondeo ávido que solo persiga
 * cuadrar las kcal hace barbaridades: en la primera versión bajaba las
 * almendras de 20 a 15 g para compensar 29 kcal, arruinando el perfil de
 * grasas. La solución es que el coste de cada movimiento combine dos cosas:
 * cuánto acerca al objetivo de energía y cuánto aleja del óptimo continuo.
 */

import { Componente, esMovil, pasoG } from "./modelo";
import { punto } from "./nutrientes";

/**
 * Múltiplo del paso más cercano a v que siga dentro de [lo, hi].
 *
 * Un límite no tiene por qué ser múltiplo del paso: si el pan parte de 60 g con
 * holgura del 40%, su techo son 84 g, que no es múltiplo de 5. En ese caso se
 * coge el mayor múltiplo que quepa (80 g). Y si en el intervalo no cabe
 * ninguno, manda el límite: pasarse del máximo sí es un error, un gramaje poco
 * redondo no.
 */
/**
 * Redondeo al par (el de Python y el de la norma IEEE 754), no el de
 * `Math.round`.
 *
 * `Math.round` manda los medios hacia arriba: `Math.round(8.5) === 9`. Python
 * los manda al par más cercano: `round(8.5) == 8`. Con pasos de 5 g y márgenes
 * simétricos, los medios exactos aparecen constantemente —127,5 g de arroz sale
 * solo—, así que sin esto el port se desviaba un gramo del motor de referencia
 * en un puñado de casos. Lo cazó la prueba diferencial.
 */
const EPS_MEDIO = 1e-7;

export function redondeoAlPar(v: number): number {
  const suelo = Math.floor(v);
  const resto = v - suelo;
  if (resto > 0.5 + EPS_MEDIO) return suelo + 1;
  if (resto < 0.5 - EPS_MEDIO) return suelo;
  return suelo % 2 === 0 ? suelo : suelo + 1;
}

export function alPaso(v: number, lo: number, hi: number, paso: number): number {
  let cand = redondeoAlPar(v / paso) * paso;
  if (cand < lo - 1e-9) cand = Math.ceil(lo / paso - 1e-9) * paso;
  else if (cand > hi + 1e-9) cand = Math.floor(hi / paso + 1e-9) * paso;
  if (cand < lo - 1e-9 || cand > hi + 1e-9)
    return Math.min(Math.max(v, lo), hi);
  return cand;
}

export function redondearAPasos(
  x: number[],
  k: number[],
  l: number[],
  u: number[],
  comps: Componente[],
  objetivo: number,
  tolerancia = 2,
  mu = 0.6,
  maxIter = 400,
): number[] {
  const xCont = x.slice();
  const paso = comps.map(pasoG);
  const movil = comps.map(esMovil);

  const out = comps.map((_, i) =>
    movil[i] ? alPaso(xCont[i], l[i], u[i], paso[i]) : xCont[i],
  );

  const indices = movil.map((m, i) => (m ? i : -1)).filter((i) => i >= 0);
  for (let iter = 0; iter < maxIter; iter++) {
    const d = objetivo - punto(k, out);
    if (Math.abs(d) <= tolerancia) break;
    let mejor: [number, number] | null = null;
    let mejorCoste = Math.abs(d);
    for (const i of indices) {
      for (const s of [paso[i], -paso[i]]) {
        const xi = out[i] + s;
        if (xi < l[i] - 1e-9 || xi > u[i] + 1e-9) continue;
        const aleja =
          k[i] * (Math.abs(xi - xCont[i]) - Math.abs(out[i] - xCont[i]));
        const coste = Math.abs(d - k[i] * s) + mu * Math.max(aleja, 0);
        if (coste < mejorCoste - 1e-9) {
          mejor = [i, s];
          mejorCoste = coste;
        }
      }
    }
    if (mejor === null) break;
    out[mejor[0]] += mejor[1];
  }
  return out;
}
