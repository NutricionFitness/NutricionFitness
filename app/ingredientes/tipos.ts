/**
 * Tipos y constantes del catálogo.
 *
 * Van aparte de `acciones.ts` a propósito: un fichero con `"use server"` solo
 * puede exportar funciones asíncronas, así que una lista de estados no cabe ahí.
 */

import type { Aviso, Propuesta } from "@/lib/openfoodfacts/convertir";

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

/** Igual que la columna `nombre_norm` de la base: minúsculas y sin tildes. */
export const normalizarNombre = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Lo que se manda a la base al crear o corregir un ingrediente.
 *
 * Vive aquí, y no en `acciones.ts`, porque la usan los dos ficheros de acciones
 * —el del formulario y el del escaneo— y un fichero con `"use server"` no puede
 * exportar nada que no sea una función asíncrona.
 *
 * `kcal_100` no está: es una columna generada por Atwater
 * (4·prot + 4·hc + 9·grasa + 7·alcohol). Mandarla sería inventarse una segunda
 * verdad para el mismo dato, y además la base la rechazaría.
 */
export function filaIngrediente(d: DatosIngrediente) {
  const nombre = d.nombre.trim();
  return {
    nombre,
    nombre_norm: normalizarNombre(nombre),
    grupo: d.grupo?.trim() || null,
    estado: d.estado,
    prot_100: d.prot_100,
    hc_100: d.hc_100,
    grasa_100: d.grasa_100,
    fibra_100: d.fibra_100,
    alcohol_100: d.alcohol_100,
    agua_100: d.agua_100,
    ags_100: d.ags_100,
    sodio_100: d.sodio_100,
    porcion_comestible: d.porcion_comestible,
    notas: d.notas?.trim() || null,
  };
}

// ------------------------------------------------------- código de barras ---

/**
 * Lo que se guarda aparte de la composición cuando el alta viene de un escaneo.
 *
 * Va suelto y no dentro de `DatosIngrediente` a propósito: `filaIngrediente`
 * se usa también al **corregir** un ingrediente, y si estos campos estuvieran
 * ahí, cada edición desde la ficha borraría el código de barras y la energía
 * declarada, que el formulario no pide. Los campos que solo se escriben al
 * crear se pasan al crear.
 */
export interface AltaEscaneada {
  codigo_barras: string;
  kcal_ref: number | null;
  /** Códigos de `alergenos` que declara la etiqueta. */
  alergenos: string[];
  /** Los que declara solo como trazas. Se marcan igual, y se dice. */
  trazas: string[];
}

/** `ingredientes.origen` de lo que entra por código de barras. */
export const ORIGEN_OFF = "openfoodfacts";

/**
 * Cómo se escriben los catorce del Anexo II cuando hay que enseñarlos.
 *
 * Los mismos nombres que inserta la migración 0007. Se repiten aquí porque el
 * conversor devuelve códigos y la tarjeta que los enseña es de cliente: pedir
 * el catálogo a la base para escribir «Frutos de cáscara» sería una consulta
 * por una lista que fija un reglamento y no va a cambiar.
 */
export const NOMBRE_ALERGENO: Record<string, string> = {
  gluten: "cereales con gluten",
  crustaceos: "crustáceos",
  huevos: "huevos",
  pescado: "pescado",
  cacahuetes: "cacahuetes",
  soja: "soja",
  leche: "leche",
  frutos_cascara: "frutos de cáscara",
  apio: "apio",
  mostaza: "mostaza",
  sesamo: "sésamo",
  sulfitos: "sulfitos",
  altramuces: "altramuces",
  moluscos: "moluscos",
};

/** El nombre si se conoce; si no, el código, que es mejor que nada. */
export const nombreAlergeno = (codigo: string) => NOMBRE_ALERGENO[codigo] ?? codigo;

/** El resultado de pasar un código de barras por `buscarPorCodigoBarras`. */
export type ResultadoEscaneo =
  /** El código no es un GTIN válido: dígito de control o longitud. */
  | { estado: "codigo_invalido" }
  /** Ya lo tienes dado de alta. No se vuelve a preguntar a nadie. */
  | { estado: "en_catalogo"; codigo: string; ingrediente: { id: number; nombre: string } }
  /** Open Food Facts no lo conoce. */
  | { estado: "no_encontrado"; codigo: string }
  /** No se ha podido preguntar: sin red, caído o demasiadas peticiones. */
  | { estado: "sin_respuesta"; codigo: string; motivo: string }
  /** Hay ficha. Se propone, no se guarda. */
  | { estado: "encontrado"; codigo: string; propuesta: Propuesta };

/**
 * Se reexportan los tipos del conversor para que el cliente no tenga que
 * importar de `lib/openfoodfacts` y quede claro qué cruza la frontera
 * servidor → cliente.
 */
export type { Propuesta as PropuestaEscaneo, Aviso as AvisoEscaneo };
