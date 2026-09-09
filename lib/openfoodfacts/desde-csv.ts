/**
 * De una fila del CSV de Open Food Facts a la forma que consume `convertir.ts`.
 *
 * ## Por qué existe este fichero
 *
 * La fase 27 eligió el volcado **JSONL** con este argumento: «trae la misma
 * forma que la API, así que lo convierte `convertir.ts` sin tocar nada; con el
 * CSV habría que escribir un segundo mapeo que se desactualiza solo». El
 * argumento era bueno y la premisa era falsa: medido sobre el volcado real, el
 * JSONL trae `nutriments` **vacío** en los productos españoles —el 0,07% con
 * macros— mientras que el CSV los trae en el **73,64%** (261.192 de 354.697).
 *
 * Así que hay que leer el CSV. Pero lo que se escribe aquí es un **adaptador**,
 * no un segundo conversor: rellena un `ProductoOFF` y se lo pasa a `convertir`,
 * que sigue siendo el único sitio donde viven las trampas de la fuente y sus
 * cuarenta pruebas. Si mañana se corrige una, se corrige una vez.
 *
 * ## Lo que el CSV NO trae, y hay que decir en voz alta
 *
 * · **`nutrition_data_per`**. En la API dice si los valores son por 100 g o por
 *   ración; sin ella, el aviso `por_racion` de la fase 14 **no se puede
 *   levantar** en el volcado. Los productos entran sin ese aviso. Es una
 *   pérdida real frente a escanear de uno en uno, y está dicha en las notas.
 * · **`alcohol_unit`**. Ver abajo.
 *
 * ## El alcohol
 *
 * Es la trampa más cara de la fase 14: `kcal_100` es una columna generada que
 * multiplica el alcohol por 7, así que leer 12 como gramos en vez de como
 * grados mete un 27% de energía de más **sin que se vea en ninguna pantalla**.
 * Con la API se resolvía leyendo `alcohol_unit`. El CSV no la trae.
 *
 * Se intentó deducir por los datos, comparando la energía declarada contra
 * Atwater con las dos lecturas, y **salió contradictorio**: con alcohol ≥2 gana
 * «% vol» (10,0% contra 12,2%), con ≥5 empatan y con ≥10 gana «gramos» (18,7%
 * contra 23,6%). Y los desvíos, del 15 al 24%, dicen que la energía declarada
 * de esas fichas no cuadra con ninguna de las dos: un Jack Daniel's que declara
 * 63 kcal, un «Vino Blanco» con 94,3 de alcohol. Ese último, además, declara
 * 660,1 kcal, que es exactamente 7 × 94,3: la energía no la puso una etiqueta,
 * la dedujo Open Food Facts de la lectura que se estaba intentando validar.
 *
 * Con eso, la decisión es **no cargar los productos con alcohol** (ver
 * `esAlcoholico`). Son 1.371 de 261.192, el 0,5%, sus datos están visiblemente
 * mal, y una bebida con la energía inventada dentro de una dieta es justo el
 * tipo de error que esta app existe para no cometer. Quien quiera uno lo
 * escanea: por ahí sí llega `alcohol_unit` y el conversor hace lo correcto.
 *
 * `incluirAlcohol` lo cambia, y entonces se lee como % vol —la decisión de la
 * fase 14— con su aviso.
 */

import type { ProductoOFF } from "./convertir";

/** Sin estas columnas no se puede hacer nada, y hay que decirlo, no adivinar. */
export const COLUMNAS_NECESARIAS = [
  "code",
  "countries_tags",
  "proteins_100g",
  "carbohydrates_100g",
  "fat_100g",
] as const;

export type Indice = Record<string, number>;

/**
 * El índice de columnas, por NOMBRE.
 *
 * Nunca por posición: el CSV tiene 211 columnas y el día que metan una en medio,
 * leer por número devolvería el campo de al lado sin dar error. Si falta alguna
 * de las necesarias, esto revienta diciendo cuál.
 */
export function indiceDeCabecera(cabecera: string): Indice {
  const cols = cabecera.split("\t");
  const idx: Indice = Object.fromEntries(cols.map((c, i) => [c.trim(), i]));
  const faltan = COLUMNAS_NECESARIAS.filter((c) => idx[c] === undefined);
  if (faltan.length)
    throw new Error(
      `El CSV no trae estas columnas: ${faltan.join(", ")}. ` +
        `Encontradas: ${cols.length}. Open Food Facts habrá cambiado el export.`,
    );
  return idx;
}

const texto = (campos: string[], idx: Indice, col: string): string =>
  (idx[col] !== undefined ? campos[idx[col]] ?? "" : "").trim();

/** Vacío y «no numérico» son lo mismo aquí: no hay dato. */
const numero = (campos: string[], idx: Indice, col: string): number | null => {
  const t = texto(campos, idx, col);
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/**
 * Las etiquetas de una columna de lista.
 *
 * `en:none` se quita: significa «no lleva alérgenos», no es un alérgeno. Las
 * que no empiezan por `en:` —se ven cosas como `it:Aloe`— se dejan pasar tal
 * cual: el conversor no las reconocerá y levantará su aviso
 * `alergeno_sin_equivalencia`, que es exactamente lo que tiene que pasar.
 */
const etiquetas = (campos: string[], idx: Indice, col: string): string[] =>
  texto(campos, idx, col)
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && t !== "en:none");

/** Un producto con alcohol declarado. Ver la explicación de arriba. */
export const esAlcoholico = (campos: string[], idx: Indice): boolean =>
  (numero(campos, idx, "alcohol_100g") ?? 0) > 0;

export interface FilaOFF {
  codigo: string;
  paises: string[];
  /** `last_modified_t`, para las recargas incrementales. */
  modificado: number | null;
  producto: ProductoOFF;
}

/**
 * Una fila del CSV, en la forma que espera `convertir()`.
 *
 * Devuelve `null` si la fila no trae ni código: el resto de descartes los
 * decide quien llama, para que el informe pueda contarlos por separado.
 */
export function filaAProducto(
  campos: string[],
  idx: Indice,
  opciones: { incluirAlcohol?: boolean } = {},
): FilaOFF | null {
  const codigo = texto(campos, idx, "code");
  if (!codigo) return null;

  const n: Record<string, unknown> = {};
  const poner = (clave: string, col: string) => {
    const v = numero(campos, idx, col);
    if (v !== null) n[clave] = v;
  };

  poner("proteins_100g", "proteins_100g");
  poner("carbohydrates_100g", "carbohydrates_100g");
  poner("fat_100g", "fat_100g");
  poner("fiber_100g", "fiber_100g");
  poner("saturated-fat_100g", "saturated-fat_100g");
  // El conversor prefiere el sodio y, si no, deduce de la sal ÷ 2,5. Se le dan
  // los dos y que decida él: esa regla vive allí.
  poner("sodium_100g", "sodium_100g");
  poner("salt_100g", "salt_100g");
  // Solo los dos campos de energía con unidad explícita. `energy_100g` a secas
  // cambia de unidad según la ficha, y el conversor ya lo ignora por eso.
  poner("energy-kcal_100g", "energy-kcal_100g");
  poner("energy-kj_100g", "energy-kj_100g");

  if (opciones.incluirAlcohol) {
    const alc = numero(campos, idx, "alcohol_100g");
    if (alc !== null && alc > 0) {
      n["alcohol_100g"] = alc;
      // El CSV no trae la unidad. Se le dice al conversor la que asume la fase
      // 14 —% vol— para que convierta y levante su aviso, en vez de que se lo
      // encuentre ausente y lo decida por omisión.
      n["alcohol_unit"] = "% vol";
    }
  }

  return {
    codigo,
    paises: etiquetas(campos, idx, "countries_tags"),
    modificado: numero(campos, idx, "last_modified_t"),
    producto: {
      product_name: texto(campos, idx, "product_name"),
      generic_name: texto(campos, idx, "generic_name"),
      brands: texto(campos, idx, "brands"),
      quantity: texto(campos, idx, "quantity"),
      // `nutrition_data_per` no existe en el CSV: se deja sin poner, y el aviso
      // `por_racion` no se levantará. Está dicho arriba y en las notas.
      nutriments: n,
      // En el CSV los alérgenos van en `allergens` —no en `allergens_tags`, que
      // no existe— y ya vienen como etiquetas (`en:milk`). `allergens_en` está
      // vacía en todas las fichas que se miraron. Las trazas sí traen
      // `traces_tags`. Comprobado sobre el fichero, no supuesto.
      allergens_tags: etiquetas(campos, idx, "allergens"),
      traces_tags: etiquetas(campos, idx, "traces_tags"),
      categories_tags: etiquetas(campos, idx, "categories_tags"),
    },
  };
}

/**
 * ¿Cabe esta propuesta en las columnas de `ingredientes`?
 *
 * Existe porque la primera carga de verdad murió a los 116.000 productos con
 * `numeric field overflow` y se llevó por delante el resto de la pasada. Alguna
 * ficha del volcado trae un número que no cabe, y **una fila mala no puede
 * tumbar un millón de filas buenas**.
 *
 * Los topes son de dos clases y conviene no mezclarlas:
 *
 *   · **Los de la base**, que son los de `0001_esquema.sql`: `numeric(8,3)`
 *     admite hasta 99.999,999 y `numeric(10,3)` hasta 9.999.999,999. Estos no
 *     son opinables: por encima, el `insert` revienta.
 *   · **Los físicos**, mucho más estrechos: en 100 g de producto no puede haber
 *     más de 100 g de nada. Es el mismo razonamiento que ya hacía el aviso
 *     `suma_imposible` del conversor, aplicado a las columnas que aquel no
 *     mira: la grasa saturada, el agua, el sodio y la energía declarada.
 *
 * Se aplican los físicos, que son los que de verdad separan un dato de una
 * errata; los de la base quedan cubiertos por ser más anchos. Devuelve el
 * motivo, para que el informe pueda decir qué se ha caído y por qué, en vez de
 * un recuento mudo.
 */
export function fueraDeRango(p: {
  prot_100: number;
  hc_100: number;
  grasa_100: number;
  fibra_100: number;
  alcohol_100: number;
  ags_100: number | null;
  agua_100: number | null;
  sodio_100: number | null;
  kcal_ref: number | null;
}): string | null {
  const porCien: [string, number | null][] = [
    ["proteína", p.prot_100],
    ["hidratos", p.hc_100],
    ["grasa", p.grasa_100],
    ["fibra", p.fibra_100],
    ["alcohol", p.alcohol_100],
    ["grasa saturada", p.ags_100],
    ["agua", p.agua_100],
  ];
  for (const [que, v] of porCien)
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 100))
      return `${que} = ${v} g por 100 g`;

  // El sodio va en miligramos: 100 g son 100.000 mg, y ahí ya no hay producto.
  if (p.sodio_100 !== null && (!Number.isFinite(p.sodio_100) || p.sodio_100 < 0 || p.sodio_100 > 100_000))
    return `sodio = ${p.sodio_100} mg por 100 g`;

  // Ni el aceite puro llega a 900 kcal/100 g. 2.000 es un tope generoso que
  // solo caza erratas.
  if (p.kcal_ref !== null && (!Number.isFinite(p.kcal_ref) || p.kcal_ref < 0 || p.kcal_ref > 2000))
    return `energía declarada = ${p.kcal_ref} kcal por 100 g`;

  return null;
}
