/**
 * Los tipos del comparador público.
 *
 * En su fichero porque `acciones.ts` lleva `"use server"` y ahí solo se pueden
 * exportar funciones asíncronas. Igual que `app/ingredientes/tipos.ts`.
 */

import type { Sustitucion } from "@/lib/dominio/sustituir";
import type { Aviso } from "@/lib/openfoodfacts/convertir";

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
  /**
   * Cuántos candidatos se han puntuado. Desde el volcado de Open Food Facts no
   * es «cuántos hay en el catálogo»: la base preselecciona y esto cuenta lo
   * preseleccionado. No se enseña en ninguna pantalla.
   */
  mirados: number;
}

// ------------------------------------------------------- código de barras ---

/**
 * Lo que hay que decir de un alimento que ha llegado por código de barras.
 *
 * Va aparte de `AlimentoPublico` y no dentro porque no es un dato del
 * alimento: es de dónde ha salido **esta vez**. El mismo yogur buscado por
 * nombre no lleva nada de esto, y la ficha lo enseña solo cuando lo hay.
 */
export interface Escaneo {
  /** El código tal cual se ha leído o tecleado, ya comprobado. */
  codigo: string;
  /**
   * De dónde salen las cifras:
   *   · `volcado`: del volcado de Open Food Facts que está en el catálogo.
   *     Nadie las ha revisado.
   *   · `propio`: de una cuenta de la app que publica su catálogo. Alguien las
   *     miró al darlas de alta.
   *   · `en_vivo`: no estaba en el catálogo y se ha preguntado ahora mismo a
   *     Open Food Facts. Tampoco las ha revisado nadie, y además no se guardan.
   */
  origen: "volcado" | "propio" | "en_vivo";
  /** Lo que el conversor tiene que avisar. Solo en vivo; el volcado entró sin ellos. */
  avisos: Aviso[];
}

/** El resultado de pasar un código de barras por `alimentoPorCodigo`. */
export type ResultadoCodigoPublico =
  /** El código no es un GTIN válido: dígito de control o longitud. */
  | { estado: "codigo_invalido" }
  /** Hay ficha, en el catálogo o en vivo. */
  | { estado: "encontrado"; alimento: AlimentoPublico; escaneo: Escaneo }
  /** Ni en el catálogo ni en Open Food Facts. */
  | { estado: "no_encontrado"; codigo: string }
  /** No estaba en el catálogo y no se ha podido preguntar fuera. */
  | { estado: "sin_respuesta"; codigo: string; motivo: string };
