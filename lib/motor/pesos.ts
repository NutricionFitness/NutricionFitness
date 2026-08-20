/**
 * Los modos de reparto son fórmulas de pesos, no algoritmos distintos.
 *
 * El solver resuelve siempre el mismo problema:
 *
 *     min  ½ · ‖ diag(1/wᵢ)·(x − x⁰) ‖²    s.a.  kᵀx = E*,  l ≤ x ≤ u
 *
 * `wᵢ` es la disposición a moverse de cada componente. Cambiando esa fórmula se
 * obtienen todos los modos de la interfaz, y añadir uno nuevo mañana es añadir
 * una fórmula, no un algoritmo.
 *
 * Sin límites activos la solución es cerrada: Δx = W²k · Δ / (kᵀW²k). De ahí
 * salen las cuatro fórmulas.
 */

import { Componente, ErrorMotor, esMovil, Modo, prioridad } from "./modelo";

export const MODOS: Modo[] = [
  "proporcional",
  "equitativo_kcal",
  "equitativo_gramos",
  "prioridades",
];

export const DESCRIPCION: Record<Modo, string> = {
  proporcional:
    "Escala la dieta entera. Mantiene el reparto de macros intacto.",
  equitativo_kcal: "Cada componente cede o absorbe las mismas kcal.",
  equitativo_gramos: "Cada componente cambia los mismos gramos.",
  prioridades:
    "Reparto en kcal ponderado por la prioridad de cada componente.",
};

export function pesos(
  modo: Modo,
  comps: Componente[],
  x0: number[],
  k: number[],
): number[] {
  if (!MODOS.includes(modo))
    throw new ErrorMotor(
      `modo desconocido: ${modo} (opciones: ${MODOS.join(", ")})`,
    );

  // Un componente con kcal 0 (agua, café solo, sal) no puede aportar energía:
  // moverlo no acerca al objetivo, así que queda fuera del reparto.
  const util = comps.map((c, i) => esMovil(c) && k[i] > 1e-9);
  const kSeguro = k.map((v) => (v > 1e-9 ? v : 1));

  let w: number[];
  if (modo === "proporcional") {
    w = x0.map((v, i) => Math.sqrt(Math.max(v, 0) / kSeguro[i]));
  } else if (modo === "equitativo_kcal") {
    w = kSeguro.map((v) => 1 / v);
  } else if (modo === "equitativo_gramos") {
    w = kSeguro.map((v) => 1 / Math.sqrt(v));
  } else {
    // OJO: es la RAÍZ de la prioridad. Como Δx ∝ w²k, la energía repartida sale
    // Δkcal = kΔx ∝ w²k² = prioridad. Con w = pr/k el reparto iría con el
    // CUADRADO de la prioridad: poner prioridad 3 movería 9 veces más, que no es
    // lo que promete el nombre del modo. Lo cazó un test en la fase 2.
    w = comps.map((c, i) => Math.sqrt(prioridad(c)) / kSeguro[i]);
  }

  w = w.map((v, i) => (util[i] ? v : 0));

  // Caso degenerado del modo proporcional: si un componente móvil está a 0 g su
  // peso sale 0 y nunca podría crecer. Se le da el peso más pequeño de los demás.
  if (modo === "proporcional") {
    const vivos = w.filter((v) => v > 0);
    if (vivos.length) {
      const min = Math.min(...vivos);
      w = w.map((v, i) => (util[i] && v <= 0 ? min : v));
    }
  }
  return w;
}
