/**
 * Tipos y constantes del catálogo.
 *
 * Van aparte de `acciones.ts` a propósito: un fichero con `"use server"` solo
 * puede exportar funciones asíncronas, así que una lista de estados no cabe ahí.
 */

/** Los seis estados que admite la restricción del esquema. */
export const ESTADOS = [
  "desconocido",
  "crudo",
  "cocido",
  "conserva",
  "seco",
  "listo",
] as const;

export type Estado = (typeof ESTADOS)[number];

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  desconocido: "desconocido",
  crudo: "crudo",
  cocido: "ya cocinado",
  conserva: "en conserva",
  seco: "seco o deshidratado",
  listo: "listo para comer",
};

export interface DatosIngrediente {
  nombre: string;
  grupo: string | null;
  estado: Estado;
  prot_100: number;
  hc_100: number;
  grasa_100: number;
  fibra_100: number;
  alcohol_100: number;
  agua_100: number | null;
  ags_100: number | null;
  sodio_100: number | null;
  porcion_comestible: number | null;
  notas: string | null;
}

/**
 * Las kilocalorías, como las calcula la base.
 *
 * `ingredientes.kcal_100` es una columna generada con esta misma fórmula, así
 * que aquí solo se repite para poder enseñarla mientras se escribe. **La fibra
 * no suma**: se contrastó en la fase 2 contra los 866 ingredientes de BEDCA con
 * energía declarada y fibra, y sumarla empeoraba el error de 1,20% a 5,86%.
 */
export const kcalAtwater = (n: {
  prot_100: number;
  hc_100: number;
  grasa_100: number;
  alcohol_100: number;
}) => 4 * n.prot_100 + 4 * n.hc_100 + 9 * n.grasa_100 + 7 * n.alcohol_100;
