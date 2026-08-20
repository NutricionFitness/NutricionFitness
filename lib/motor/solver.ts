/**
 * El solver: reparte una diferencia de energía entre los componentes.
 *
 * Dos caminos, según se controle o no el reparto de macronutrientes:
 *
 *   · Solo energía  → solución cerrada + conjunto activo para los límites.
 *                     Exacta, determinista y sin dependencias.
 *   · Con macros    → problema cuadrático con una igualdad lineal y cajas.
 *                     La versión Python usaba SLSQP de scipy; aquí va un
 *                     gradiente proyectado propio, porque scipy no existe en el
 *                     navegador y además queríamos poder ejecutar el ajuste
 *                     entero en el cliente.
 */

import {
  Cambio,
  Componente,
  comida,
  Dieta,
  ErrorMotor,
  esMovil,
  Macro,
  MACROS,
  Modo,
  Resultado,
  validarDieta,
} from "./modelo";
import {
  gramosObjetivo,
  limites,
  matrices,
  porcentajes,
  punto,
} from "./nutrientes";
import { pesos as calcularPesos } from "./pesos";
import { redondearAPasos } from "./redondeo";

const TOLERANCIA_KCAL = 1e-6;

const recorta = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

// ---------------------------------------------------------------------------
/** Conjunto activo: resolver libre, congelar los que se salen, repetir. */
function resolverEnergia(
  x0: number[],
  k: number[],
  w: number[],
  l: number[],
  u: number[],
  objetivo: number,
): number[] {
  const n = x0.length;
  const x = x0.map((v, i) => recorta(v, l[i], u[i]));
  const libres = w.map((v) => v > 0);
  for (let iter = 0; iter < n + 2; iter++) {
    const delta = objetivo - punto(k, x);
    if (Math.abs(delta) < TOLERANCIA_KCAL || !libres.some(Boolean)) break;
    const W2k = w.map((v, i) => (libres[i] ? v * v * k[i] : 0));
    const denom = punto(k, W2k);
    if (denom <= 1e-12) break;
    const paso = W2k.map((v) => (v * delta) / denom);
    const xNuevo = x.map((v, i) => v + paso[i]);
    const fuera = xNuevo.map(
      (v, i) => (v < l[i] - 1e-9 || v > u[i] + 1e-9) && libres[i],
    );
    for (let i = 0; i < n; i++) x[i] = recorta(xNuevo[i], l[i], u[i]);
    if (!fuera.some(Boolean)) break;
    for (let i = 0; i < n; i++) if (fuera[i]) libres[i] = false;
  }
  return x;
}

// ---------------------------------------------------------------------------
/**
 * Proyección euclídea sobre { a·y = b, ly ≤ y ≤ uy }.
 *
 * El óptimo tiene la forma y = recorta(z + λa, ly, uy) para un multiplicador λ.
 * Como todos los a[i] ≥ 0 (la energía por gramo nunca es negativa), la función
 * g(λ) = a·recorta(z + λa) es monótona creciente, así que λ se encuentra por
 * bisección sin riesgo de mínimos locales.
 */
function proyectar(
  z: number[],
  a: number[],
  b: number[] | number,
  ly: number[],
  uy: number[],
): number[] {
  const objetivo = typeof b === "number" ? b : b[0];
  const g = (lam: number) => {
    let s = 0;
    for (let i = 0; i < z.length; i++)
      s += a[i] * recorta(z[i] + lam * a[i], ly[i], uy[i]);
    return s;
  };
  let lo = -1;
  let hi = 1;
  let intentos = 0;
  while (g(lo) > objetivo && intentos++ < 200) lo *= 2;
  intentos = 0;
  while (g(hi) < objetivo && intentos++ < 200) hi *= 2;
  for (let it = 0; it < 200; it++) {
    const mid = (lo + hi) / 2;
    const v = g(mid);
    if (Math.abs(v - objetivo) < 1e-12) {
      lo = mid;
      hi = mid;
      break;
    }
    if (v < objetivo) lo = mid;
    else hi = mid;
  }
  const lam = (lo + hi) / 2;
  return z.map((v, i) => recorta(v + lam * a[i], ly[i], uy[i]));
}

/**
 * QP: quedarse cerca de la dieta original cumpliendo el reparto de macros.
 *
 * La normalización de escala no es cosmética: sin ella el término de «no te
 * alejes de la dieta original» es tres órdenes de magnitud mayor que el de
 * macros y lo anula por completo, de modo que `fuerzaMacros` no haría nada.
 *
 * Se trabaja en la variable y = (x − x⁰)/w, donde el regularizador es la
 * identidad. Eso deja el problema bien condicionado y el gradiente proyectado
 * converge en pocas decenas de iteraciones.
 */
function resolverConMacros(
  x0: number[],
  A: number[][],
  k: number[],
  w: number[],
  l: number[],
  u: number[],
  objetivo: number,
  MObj: number[],
  lamV: number[],
  xIni: number[],
): { x: number[]; ok: boolean } {
  const n = x0.length;
  let wEf = w.map((v) => (v > 0 ? v : 1e-9));
  let base = 0;
  for (let i = 0; i < n; i++) {
    const r = (xIni[i] - x0[i]) / wEf[i];
    base += r * r;
  }
  base *= 0.5;
  if (base > 1e-12) {
    const f = Math.sqrt(base);
    wEf = wEf.map((v) => v * f); // ahora J_reg(xIni) == 1
  }

  const M0 = A.map((fila) => punto(fila, x0));
  const esc = M0.map((v) => Math.max(Math.abs(v), 1));

  const aY = k.map((v, i) => v * wEf[i]);
  const bY = objetivo - punto(k, x0);
  const ly = l.map((v, i) => (v - x0[i]) / wEf[i]);
  const uy = u.map((v, i) => (v - x0[i]) / wEf[i]);
  const aX = (y: number[]) => y.map((v, i) => x0[i] + wEf[i] * v);

  const J = (y: number[]) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += y[i] * y[i];
    s *= 0.5;
    const x = aX(y);
    for (let j = 0; j < 3; j++) {
      if (lamV[j] === 0) continue;
      const r = (punto(A[j], x) - MObj[j]) / esc[j];
      s += lamV[j] * r * r;
    }
    return s;
  };

  const grad = (y: number[]) => {
    const x = aX(y);
    const g = y.slice();
    for (let j = 0; j < 3; j++) {
      if (lamV[j] === 0) continue;
      const c = (2 * lamV[j] * (punto(A[j], x) - MObj[j])) / (esc[j] * esc[j]);
      for (let i = 0; i < n; i++) g[i] += A[j][i] * c * wEf[i];
    }
    return g;
  };

  let y = proyectar(
    xIni.map((v, i) => (v - x0[i]) / wEf[i]),
    aY,
    bY,
    ly,
    uy,
  );
  let t = 1;
  let Jy = J(y);
  for (let iter = 0; iter < 800; iter++) {
    const g = grad(y);
    let aceptado = false;
    for (let intento = 0; intento < 60; intento++) {
      const yNuevo = proyectar(
        y.map((v, i) => v - t * g[i]),
        aY,
        bY,
        ly,
        uy,
      );
      let dif = 0;
      let lineal = 0;
      for (let i = 0; i < n; i++) {
        const d = yNuevo[i] - y[i];
        dif += d * d;
        lineal += g[i] * d;
      }
      const Jn = J(yNuevo);
      if (Jn <= Jy + lineal + dif / (2 * t) + 1e-15) {
        const avance = Math.sqrt(dif);
        y = yNuevo;
        Jy = Jn;
        aceptado = true;
        if (avance < 1e-12) iter = 1e9; // convergido
        break;
      }
      t *= 0.5;
    }
    if (!aceptado) break;
    t *= 1.5;
  }

  const x = aX(y).map((v, i) => recorta(v, l[i], u[i]));
  // Si el gradiente proyectado no cerrase la energía, manda el resultado exacto
  // de solo-energía: cuadrar las kcal es la restricción dura.
  if (Math.abs(punto(k, x) - objetivo) > 1e-3) return { x: xIni, ok: false };
  return { x, ok: true };
}

/**
 * Valor del funcional que minimiza el modo con macros.
 *
 * Se exporta porque es la única forma honesta de comparar dos optimizadores
 * distintos: el port y la referencia de Python no tienen por qué devolver los
 * mismos gramos, pero sí resolver el mismo problema convexo. Gana el que
 * consiga un valor menor cumpliendo las restricciones.
 */
export function objetivoQP(
  dieta: Dieta,
  x: number[],
  opciones: OpcionesAjuste = {},
): number {
  const {
    modo = "prioridades",
    macrosObjetivo = null,
    macrosFijos = null,
    fuerzaMacros = 60,
    holguraRel = 0.4,
  } = opciones;
  const comps = dieta.componentes;
  const { x0, A, k } = matrices(dieta);
  const { l, u } = limites(comps, holguraRel);
  const w = calcularPesos(modo, comps, x0, k);
  const xIni = resolverEnergia(x0, k, w, l, u, punto(k, x));

  let wEf = w.map((v) => (v > 0 ? v : 1e-9));
  let base = 0;
  for (let i = 0; i < x0.length; i++) {
    const r = (xIni[i] - x0[i]) / wEf[i];
    base += r * r;
  }
  base *= 0.5;
  if (base > 1e-12) {
    const f = Math.sqrt(base);
    wEf = wEf.map((v) => v * f);
  }

  const M0 = A.map((fila) => punto(fila, x0));
  const esc = M0.map((v) => Math.max(Math.abs(v), 1));
  const MObj = [0, 0, 0];
  const lamV = [0, 0, 0];
  if (macrosObjetivo) {
    const objetivoG = gramosObjetivo(macrosObjetivo, punto(k, x));
    MACROS.forEach((m, j) => {
      if (macrosObjetivo[m] !== undefined) {
        MObj[j] = objetivoG[m];
        lamV[j] = fuerzaMacros;
      }
    });
  }
  MACROS.forEach((m, j) => {
    if (macrosFijos && macrosFijos.includes(m)) {
      MObj[j] = M0[j];
      lamV[j] = fuerzaMacros * 5;
    }
  });

  let s = 0;
  for (let i = 0; i < x0.length; i++) {
    const r = (x[i] - x0[i]) / wEf[i];
    s += r * r;
  }
  s *= 0.5;
  for (let j = 0; j < 3; j++) {
    if (lamV[j] === 0) continue;
    const r = (punto(A[j], x) - MObj[j]) / esc[j];
    s += lamV[j] * r * r;
  }
  return s;
}

// ---------------------------------------------------------------------------
export interface OpcionesAjuste {
  modo?: Modo;
  /** reparto deseado en % de la energía, p.ej. { prot: .35, hc: .35, grasa: .30 } */
  macrosObjetivo?: Partial<Record<Macro, number>> | null;
  /** macros que deben conservar sus GRAMOS actuales */
  macrosFijos?: Macro[] | null;
  /**
   * Cuánto puede alejarse la dieta con tal de cumplir el reparto. Es un
   * compromiso real y visible: no es una constante interna, va a la interfaz.
   */
  fuerzaMacros?: number;
  holguraRel?: number;
  redondear?: boolean;
  toleranciaKcal?: number;
}

export function ajustar(
  dieta: Dieta,
  objetivoKcal: number,
  opciones: OpcionesAjuste = {},
): Resultado {
  const {
    modo = "prioridades",
    macrosObjetivo = null,
    macrosFijos = null,
    fuerzaMacros = 60,
    holguraRel = 0.4,
    redondear = true,
    toleranciaKcal = 2,
  } = opciones;

  validarDieta(dieta);
  if (objetivoKcal < 0)
    throw new ErrorMotor("el objetivo de energía no puede ser negativo");

  const comps = dieta.componentes;
  const { x0, A, k } = matrices(dieta);
  const { l, u } = limites(comps, holguraRel);
  const w = calcularPesos(modo, comps, x0, k);

  const E0 = punto(k, x0);
  const EMin = punto(k, l);
  const EMax = punto(k, u);
  const avisos: string[] = [];

  const construir = (
    x: number[],
    factible = true,
    motivo = "",
  ): Resultado => {
    const nuevos: Componente[] = comps.map((c, i) => ({ ...c, gramos: x[i] }));
    const nueva: Dieta = { ...dieta, componentes: nuevos };
    const M0: Record<Macro, number> = {
      prot: punto(A[0], x0),
      hc: punto(A[1], x0),
      grasa: punto(A[2], x0),
    };
    const M1: Record<Macro, number> = {
      prot: punto(A[0], x),
      hc: punto(A[1], x),
      grasa: punto(A[2], x),
    };
    const E1 = punto(k, x);
    const cambios: Cambio[] = comps.map((c, i) => ({
      nombre: c.ingrediente.nombre,
      comida: comida(c),
      gramosAntes: x0[i],
      gramosDespues: x[i],
      kcalAntes: k[i] * x0[i],
      kcalDespues: k[i] * x[i],
      enLimite:
        esMovil(c) &&
        w[i] > 0 &&
        (Math.abs(x[i] - l[i]) < 1e-6 || Math.abs(x[i] - u[i]) < 1e-6),
      deltaG: x[i] - x0[i],
      deltaKcal: k[i] * x[i] - k[i] * x0[i],
    }));
    return {
      dietaOriginal: dieta,
      dieta: nueva,
      objetivoKcal,
      energiaInicial: E0,
      energiaFinal: E1,
      macrosInicial: M0,
      macrosFinal: M1,
      pctInicial: porcentajes(M0, E0),
      pctFinal: porcentajes(M1, E1),
      cambios,
      rangoAlcanzable: [EMin, EMax],
      factible,
      motivo,
      avisos,
      errorKcal: E1 - objetivoKcal,
      saturados: cambios.filter((c) => c.enLimite).map((c) => c.nombre),
    };
  };

  if (!w.some((v) => v > 0))
    return construir(
      x0,
      false,
      "todos los componentes están bloqueados o no aportan energía",
    );

  if (!(EMin - 1e-6 <= objetivoKcal && objetivoKcal <= EMax + 1e-6)) {
    const falta = objetivoKcal - (objetivoKcal > EMax ? EMax : EMin);
    return construir(
      x0,
      false,
      `objetivo fuera del rango alcanzable ${EMin.toFixed(0)}-${EMax.toFixed(0)} ` +
        `kcal; faltan ${falta >= 0 ? "+" : ""}${falta.toFixed(0)} kcal. ` +
        "Amplía los márgenes o desbloquea componentes.",
    );
  }

  let x = resolverEnergia(x0, k, w, l, u, objetivoKcal);

  if (macrosObjetivo || (macrosFijos && macrosFijos.length)) {
    const M0v = A.map((fila) => punto(fila, x0));
    const MObj = [0, 0, 0];
    const lamV = [0, 0, 0];
    if (macrosObjetivo) {
      const objetivoG = gramosObjetivo(macrosObjetivo, objetivoKcal);
      MACROS.forEach((m, j) => {
        if (macrosObjetivo[m] !== undefined) {
          MObj[j] = objetivoG[m];
          lamV[j] = fuerzaMacros;
        }
      });
    }
    MACROS.forEach((m, j) => {
      if (macrosFijos && macrosFijos.includes(m)) {
        MObj[j] = M0v[j];
        lamV[j] = fuerzaMacros * 5;
      }
    });
    const res = resolverConMacros(x0, A, k, w, l, u, objetivoKcal, MObj, lamV, x);
    x = res.x;
    if (!res.ok)
      avisos.push(
        "no se pudo optimizar el reparto de macros sin perder el objetivo de " +
          "energía; se aplica el reparto simple",
      );
  }

  if (redondear)
    x = redondearAPasos(x, k, l, u, comps, objetivoKcal, toleranciaKcal);

  const res = construir(x);

  if (Math.abs(res.errorKcal) > Math.max(toleranciaKcal, 1e-3))
    avisos.push(
      `no se ha podido cuadrar la energía exactamente: quedan ` +
        `${res.errorKcal >= 0 ? "+" : ""}${res.errorKcal.toFixed(1)} kcal`,
    );
  if (macrosObjetivo) {
    for (const m of MACROS) {
      const pedido = macrosObjetivo[m];
      if (pedido === undefined) continue;
      const pedidoPct = pedido <= 1.5 ? pedido * 100 : pedido;
      const logrado = res.pctFinal[m] ?? 0;
      if (Math.abs(logrado - pedidoPct) > 2)
        avisos.push(
          `${m}: se pedía ${pedidoPct.toFixed(0)}% de la energía y se ha ` +
            `llegado a ${logrado.toFixed(1)}%. Moviendo gramos de los mismos ` +
            "alimentos no da más de sí: haría falta sustituir ingredientes o " +
            "subir fuerzaMacros.",
        );
    }
  }
  if (res.saturados.length)
    avisos.push("en su límite: " + res.saturados.join(", "));
  return res;
}
