/**
 * Objetos de dominio del motor de ajuste.
 *
 * Port del paquete Python de la fase 2. El motor no sabe nada de React, de
 * Supabase ni de HTTP: entra una dieta, sale otra. Eso permite ejecutarlo tanto
 * en el navegador (para que el control de kcal responda al instante) como en el
 * servidor, con el mismo código.
 */

export type ModeloEnergia = "atwater" | "declarada";
export type Modo =
  | "proporcional"
  | "equitativo_kcal"
  | "equitativo_gramos"
  | "prioridades";

export const MACROS = ["prot", "hc", "grasa"] as const;
export type Macro = (typeof MACROS)[number];

export class ErrorMotor extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorMotor";
  }
}

/** Composición por 100 g de porción comestible. */
export interface Ingrediente {
  nombre: string;
  prot: number;
  hc: number;
  grasa: number;
  fibra?: number;
  alcohol?: number;
  /** Energía declarada por la fuente, si la trae. */
  kcalRef?: number | null;
  id?: number | null;
  grupo?: string | null;
  estado?: string;
}

/**
 * Un ingrediente con su cantidad y sus reglas de ajuste.
 *
 * prioridad  0   -> no se toca (equivale a bloqueado)
 *            1   -> normal
 *            >1  -> absorbe más cambio que el resto
 */
export interface Componente {
  ingrediente: Ingrediente;
  gramos: number;
  comida?: string;
  bloqueado?: boolean;
  prioridad?: number;
  minG?: number | null;
  maxG?: number | null;
  pasoG?: number;
}

export interface Dieta {
  componentes: Componente[];
  nombre?: string;
  modeloEnergia?: ModeloEnergia;
}

export interface Cambio {
  nombre: string;
  comida: string;
  gramosAntes: number;
  gramosDespues: number;
  kcalAntes: number;
  kcalDespues: number;
  enLimite: boolean;
  deltaG: number;
  deltaKcal: number;
}

export interface Resultado {
  dietaOriginal: Dieta;
  dieta: Dieta;
  objetivoKcal: number;
  energiaInicial: number;
  energiaFinal: number;
  macrosInicial: Record<Macro, number>;
  macrosFinal: Record<Macro, number>;
  pctInicial: Record<Macro, number>;
  pctFinal: Record<Macro, number>;
  cambios: Cambio[];
  rangoAlcanzable: [number, number];
  factible: boolean;
  motivo: string;
  avisos: string[];
  errorKcal: number;
  saturados: string[];
}

// --- accesores con valores por defecto -------------------------------------
export const fibra = (i: Ingrediente) => i.fibra ?? 0;
export const alcohol = (i: Ingrediente) => i.alcohol ?? 0;
export const prioridad = (c: Componente) => c.prioridad ?? 1;
export const pasoG = (c: Componente) => c.pasoG ?? 5;
export const bloqueado = (c: Componente) => c.bloqueado ?? false;
export const comida = (c: Componente) => c.comida ?? "";

/** Un componente móvil es el que el motor puede tocar. */
export const esMovil = (c: Componente) => !bloqueado(c) && prioridad(c) > 0;

// --- validación -------------------------------------------------------------
export function validarIngrediente(i: Ingrediente): void {
  for (const campo of ["prot", "hc", "grasa", "fibra", "alcohol"] as const) {
    const v = i[campo];
    if (v === null) throw new ErrorMotor(`${i.nombre}: ${campo} no puede ser null`);
    if (v !== undefined && (Number.isNaN(v) || v < 0))
      throw new ErrorMotor(`${i.nombre}: ${campo} negativo (${v})`);
  }
}

export function validarComponente(c: Componente): void {
  validarIngrediente(c.ingrediente);
  const n = c.ingrediente.nombre;
  if (c.gramos < 0) throw new ErrorMotor(`${n}: gramos negativos`);
  if (prioridad(c) < 0) throw new ErrorMotor(`${n}: prioridad negativa`);
  if (pasoG(c) <= 0) throw new ErrorMotor(`${n}: pasoG debe ser > 0`);
  if (c.minG != null && c.maxG != null && c.minG > c.maxG)
    throw new ErrorMotor(`${n}: minG > maxG`);
}

export function validarDieta(d: Dieta): void {
  if (!d.componentes || d.componentes.length === 0)
    throw new ErrorMotor("una dieta necesita al menos un componente");
  d.componentes.forEach(validarComponente);
}

/** Agrupa los componentes por comida, conservando el orden de aparición. */
export function comidas(d: Dieta): Map<string, Componente[]> {
  const fuera = new Map<string, Componente[]>();
  for (const c of d.componentes) {
    const k = comida(c);
    if (!fuera.has(k)) fuera.set(k, []);
    fuera.get(k)!.push(c);
  }
  return fuera;
}

export function resumen(r: Resultado): string {
  const L: string[] = [
    `${r.dieta.nombre ?? "dieta"}: ${r.energiaInicial.toFixed(0)} -> ` +
      `${r.energiaFinal.toFixed(0)} kcal (objetivo ${r.objetivoKcal.toFixed(0)}, ` +
      `error ${r.errorKcal >= 0 ? "+" : ""}${r.errorKcal.toFixed(1)})`,
  ];
  if (!r.factible) L.push(`INFACTIBLE: ${r.motivo}`);
  for (const c of r.cambios) {
    if (Math.abs(c.deltaG) >= 0.5)
      L.push(
        `   ${c.nombre.slice(0, 38).padEnd(38)} ${c.gramosAntes.toFixed(0)} -> ` +
          `${c.gramosDespues.toFixed(0)} g  (${c.deltaG >= 0 ? "+" : ""}` +
          `${c.deltaG.toFixed(0)} g, ${c.deltaKcal >= 0 ? "+" : ""}` +
          `${c.deltaKcal.toFixed(0)} kcal)${c.enLimite ? "  [en su límite]" : ""}`,
      );
  }
  for (const m of MACROS)
    L.push(
      `   ${m.padEnd(8)} ${r.macrosInicial[m].toFixed(1)} -> ` +
        `${r.macrosFinal[m].toFixed(1)} g   ${r.pctInicial[m].toFixed(1)}% -> ` +
        `${r.pctFinal[m].toFixed(1)}%`,
    );
  for (const a of r.avisos) L.push(`   aviso: ${a}`);
  return L.join("\n");
}
