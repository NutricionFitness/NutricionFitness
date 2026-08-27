/**
 * Los tipos del comparador público.
 *
 * En su fichero porque `acciones.ts` lleva `"use server"` y ahí solo se pueden
 * exportar funciones asíncronas. Igual que `app/ingredientes/tipos.ts`.
 */

import type { Sustitucion } from "@/lib/dominio/sustituir";

/** Un alimento tal y como sale del catálogo público. */
export interface AlimentoPublico {
  id: number;
  nombre: string;
  grupo: string | null;
  estado: string;
  /** Por 100 g de porción comestible. */
  prot: number;
  hc: number;
  grasa: number;
  fibra: number;
  alcohol: number;
  kcal100: number;
  /** La que declara la fuente, si la declara. */
  kcalRef: number | null;
  porcionComestible: number | null;
  codigoBedca: string | null;
}

/** Cómo se ordenan los sustitutos. */
export type Orden =
  /** El que menos altera los macros. Es la pregunta «¿por qué lo cambio?». */
  | "parecido"
  | "mas_prot"
  | "menos_prot"
  | "mas_hc"
  | "menos_hc"
  | "mas_grasa"
  | "menos_grasa";

export interface PaginaSustitutos {
  sustitutos: Sustitucion[];
  /** Cuántos hay en total con estos filtros, para saber si queda más. */
  total: number;
  /** Cuántos candidatos se han mirado. Da la medida de lo que hay detrás. */
  mirados: number;
}
