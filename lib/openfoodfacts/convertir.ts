/**
 * De una ficha de Open Food Facts a un ingrediente de la app.
 *
 * Open Food Facts lo rellena la gente: se fotografía una etiqueta y se teclea.
 * Hay fichas impecables y hay fichas con los valores de una ración metidos en
 * la columna de los 100 g. **Nada de lo que sale de aquí se guarda solo.** Esta
 * función propone y, sobre todo, avisa: los `avisos` son la mitad del trabajo,
 * no un adorno.
 *
 * Sin dependencias, como el motor, para poder probarla de verdad.
 */

/**
 * Los mismos estados que admite la base.
 *
 * Se repiten aquí en vez de importarlos de `app/ingredientes/tipos.ts` para que
 * `lib/` no dependa de `app/`: el motor y el dominio tampoco lo hacen, y esa es
 * la razón de que se puedan probar sin levantar nada.
 *
 * Que no se separen de la lista de verdad no se confía a este comentario: hay
 * una comprobación en tiempo de compilación en `convertir.test.ts` que falla si
 * las dos listas dejan de coincidir.
 */
export type EstadoIngrediente =
  | "desconocido"
  | "crudo"
  | "cocido"
  | "conserva"
  | "seco"
  | "listo";

// ---------------------------------------------------------------- la fuente --

/** Lo que se pide de Open Food Facts. Todo opcional: falta la mitad a menudo. */
export interface ProductoOFF {
  product_name?: string;
  product_name_es?: string;
  generic_name?: string;
  generic_name_es?: string;
  brands?: string;
  quantity?: string;
  /** "100g" o "serving". Si es "serving", los `_100g` los ha calculado OFF. */
  nutrition_data_per?: string;
  nutriments?: Record<string, unknown>;
  allergens_tags?: string[];
  traces_tags?: string[];
  categories_tags?: string[];
}

// ---------------------------------------------------------------- la salida --

export interface Aviso {
  /** Estable, para poder probarlo sin depender de cómo esté redactado. */
  clave:
    | "sin_datos"
    | "por_racion"
    | "desvio_kcal"
    | "suma_imposible"
    | "todo_cero"
    | "sin_nombre"
    | "sin_fibra"
    | "alcohol_por_volumen"
    | "estado_seco"
    | "alergeno_sin_equivalencia";
  gravedad: "alto" | "medio";
  texto: string;
}

export interface Propuesta {
  nombre: string;
  grupo: string | null;
  estado: EstadoIngrediente;
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
  codigo_barras: string;
  /** La energía que declara la etiqueta. Va a `kcal_ref`, no a `kcal_100`. */
  kcal_ref: number | null;
  /** Códigos de `alergenos` que la etiqueta declara como contenidos. */
  alergenos: string[];
  /** Los que la etiqueta declara solo como trazas. */
  trazas: string[];
  avisos: Aviso[];
}

// ------------------------------------------------------------------ tablas --

/**
 * Etiquetas de Open Food Facts → códigos de la tabla `alergenos`.
 *
 * Los catorce del Anexo II están completos. Las variantes que se ven en fichas
 * reales —`en:wheat` en vez de `en:gluten`, `en:almonds` en vez de `en:nuts`—
 * van también: no cuesta nada y son las que se escapan.
 *
 * Lo que NO está y es deliberado: `en:pine-nuts` y `en:chestnuts`. El piñón y
 * la castaña no están en la lista cerrada de frutos de cáscara del Anexo II
 * —está en `alergenos-tabla.mjs` y en `alergias.md`—, así que meterlos aquí
 * contradiría la tabla curada. Salen por el aviso de «sin equivalencia», que
 * para eso está: se ven, y quien quiera los declara como alérgeno propio.
 */
const ALERGENOS_OFF: Record<string, string> = {
  "en:gluten": "gluten",
  "en:wheat": "gluten",
  "en:barley": "gluten",
  "en:rye": "gluten",
  "en:oats": "gluten",
  "en:spelt": "gluten",
  "en:kamut": "gluten",

  "en:crustaceans": "crustaceos",
  "en:eggs": "huevos",
  "en:fish": "pescado",
  "en:peanuts": "cacahuetes",

  "en:soybeans": "soja",
  "en:soya": "soja",
  "en:soy": "soja",

  "en:milk": "leche",
  "en:lactose": "leche",

  "en:nuts": "frutos_cascara",
  "en:almonds": "frutos_cascara",
  "en:hazelnuts": "frutos_cascara",
  "en:walnuts": "frutos_cascara",
  "en:cashew-nuts": "frutos_cascara",
  "en:pistachio-nuts": "frutos_cascara",
  "en:pecan-nuts": "frutos_cascara",
  "en:macadamia-nuts": "frutos_cascara",
  "en:brazil-nuts": "frutos_cascara",

  "en:celery": "apio",
  "en:mustard": "mostaza",

  "en:sesame-seeds": "sesamo",
  "en:sesame": "sesamo",

  "en:sulphur-dioxide-and-sulphites": "sulfitos",
  "en:sulphites": "sulfitos",

  "en:lupin": "altramuces",
  "en:molluscs": "moluscos",
};

/**
 * Categorías de Open Food Facts → los 15 grupos del catálogo.
 *
 * Corta a propósito. Solo están las familias en las que acertar es fácil, y se
 * mira de la categoría más específica a la más general. Lo que no encaje se
 * queda sin grupo, que es lo honesto: el desplegable está justo al lado y
 * elegirlo cuesta un clic, mientras que un grupo mal puesto no se ve y se
 * queda ahí.
 */
const GRUPOS_OFF: [string, string][] = [
  ["en:dairies", "Lácteos"],
  ["en:milks", "Lácteos"],
  ["en:yogurts", "Lácteos"],
  ["en:cheeses", "Lácteos"],
  ["en:creams", "Lácteos"],
  ["en:butters", "Lácteos"],

  ["en:eggs", "Huevos"],

  ["en:seafood", "Pescados y mariscos"],
  ["en:fishes", "Pescados y mariscos"],
  ["en:canned-fishes", "Pescados y mariscos"],

  ["en:meats", "Carnes y derivados"],
  ["en:poultries", "Carnes y derivados"],
  ["en:hams", "Carnes y derivados"],
  ["en:sausages", "Carnes y derivados"],
  ["en:charcuteries", "Carnes y derivados"],

  ["en:legumes", "Legumbres"],
  ["en:pulses", "Legumbres"],
  ["en:lentils", "Legumbres"],
  ["en:chickpeas", "Legumbres"],

  ["en:nuts", "Frutos secos y semillas"],
  ["en:seeds", "Frutos secos y semillas"],

  ["en:vegetables", "Verduras y hortalizas"],
  ["en:fruits", "Frutas"],

  ["en:cereals-and-potatoes", "Cereales y derivados"],
  ["en:breads", "Cereales y derivados"],
  ["en:pastas", "Cereales y derivados"],
  ["en:rices", "Cereales y derivados"],
  ["en:breakfast-cereals", "Cereales y derivados"],
  ["en:flours", "Cereales y derivados"],

  ["en:vegetable-oils", "Grasas y aceites"],
  ["en:olive-oils", "Grasas y aceites"],
  ["en:fats", "Grasas y aceites"],

  ["en:sauces", "Salsas y condimentos"],
  ["en:condiments", "Salsas y condimentos"],
  ["en:spices", "Salsas y condimentos"],

  ["en:sweeteners", "Azúcares y dulces"],
  ["en:chocolates", "Azúcares y dulces"],
  ["en:biscuits", "Azúcares y dulces"],
  ["en:confectioneries", "Azúcares y dulces"],
  ["en:sugars", "Azúcares y dulces"],
  ["en:jams", "Azúcares y dulces"],

  ["en:beverages", "Bebidas"],
  ["en:waters", "Bebidas"],
  ["en:alcoholic-beverages", "Bebidas"],

  ["en:meals", "Precocinados"],
  ["en:prepared-meats", "Precocinados"],
  ["en:pizzas", "Precocinados"],

  ["en:dietary-supplements", "Suplementos"],
];

/**
 * Categorías que dicen que lo del envase está **seco**, no listo para comer.
 *
 * Importa porque el estado no es un adorno: es lo que empareja crudo con
 * cocido y lo que dispara el aviso de «esta dieta mezcla estados». 100 g de
 * macarrones del paquete no son 100 g de macarrones en el plato.
 */
const CATEGORIAS_SECAS = [
  "en:pastas",
  "en:dried-pastas",
  "en:rices",
  "en:flours",
  "en:dried-legumes",
  "en:couscous",
  "en:semolinas",
  "en:dried-fruits",
  "en:breakfast-cereals",
];

// ------------------------------------------------------------- utilidades --

/** Un número utilizable, o null. OFF devuelve unas veces número y otras texto. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Redondea a 3 decimales, que es lo que admiten las columnas `numeric(8,3)`. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// --------------------------------------------------------------- el nombre --

/** «Yogur natural» + marca «Hacendado» → «Yogur natural (Hacendado)». */
export function nombreDelProducto(p: ProductoOFF): string {
  const base = (
    p.product_name_es ||
    p.product_name ||
    p.generic_name_es ||
    p.generic_name ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const marca = (p.brands ?? "").split(",")[0].replace(/\s+/g, " ").trim();
  if (!marca) return base;
  if (!base) return marca;

  // Media Europa mete la marca dentro del nombre del producto. Repetirla
  // dejaría «Yogur Hacendado (Hacendado)».
  if (sinTildes(base).includes(sinTildes(marca))) return base;
  return `${base} (${marca})`;
}

// ----------------------------------------------------------- la conversión --

/**
 * Convierte una ficha en una propuesta de ingrediente.
 *
 * @param codigo el código de barras ya comprobado (ver `ean.ts`).
 * @param hoy    la fecha que se escribe en las notas; se pasa para poder probarlo.
 */
export function convertir(
  p: ProductoOFF,
  codigo: string,
  hoy: Date = new Date(),
): Propuesta {
  const avisos: Aviso[] = [];
  const n = p.nutriments ?? {};

  // ---------------------------------------------------------- nutrientes --
  const prot = num(n["proteins_100g"]);
  const hc = num(n["carbohydrates_100g"]);
  const grasa = num(n["fat_100g"]);
  const fibra = num(n["fiber_100g"]);
  const ags = num(n["saturated-fat_100g"]);

  /**
   * El alcohol de Open Food Facts viene en **% vol**, no en gramos.
   *
   * Es la trampa más cara de este fichero: `kcal_100` es una columna generada
   * que multiplica el alcohol por 7, así que copiar el 12 de un vino como si
   * fueran 12 g mete un 27% de más en la energía de ese ingrediente. Un mililitro
   * de etanol pesa 0,789 g, y para un vino o una cerveza 100 ml pesan ~100 g,
   * de donde sale el factor. Es aproximado, y se dice.
   */
  const alcBruto = num(n["alcohol_100g"]) ?? num(n["alcohol"]);
  const unidadAlc = String(n["alcohol_unit"] ?? "").trim().toLowerCase();
  let alcohol = alcBruto;
  if (alcBruto !== null && alcBruto > 0 && unidadAlc !== "g") {
    alcohol = alcBruto * 0.789;
    avisos.push({
      clave: "alcohol_por_volumen",
      gravedad: "medio",
      texto:
        `La etiqueta da ${alcBruto} % vol de alcohol y aquí hacen falta gramos: ` +
        `se ha convertido a ${r3(alcohol)} g por 100 g (×0,789, la densidad del ` +
        `etanol). Es aproximado, porque supone que 100 ml pesan 100 g.`,
    });
  }

  /**
   * Sodio: OFF lo da en gramos y la columna está en miligramos.
   *
   * Si no viene, se saca de la sal dividiendo por 2,5, que es el factor del
   * etiquetado europeo. Esto NO genera aviso a propósito: la conversión es
   * exacta por definición, y como casi toda etiqueta europea declara sal y no
   * sodio, saltaría en prácticamente todos los productos. Un aviso que sale
   * siempre enseña a no mirar los avisos. Queda dicho en las notas, que es
   * donde va el rastro de las cosas que no hay que decidir.
   */
  const sodioG = num(n["sodium_100g"]);
  const salG = num(n["salt_100g"]);
  let sodio: number | null = sodioG !== null ? sodioG * 1000 : null;
  const sodioDesdeSal = sodio === null && salG !== null;
  if (sodioDesdeSal) sodio = (salG! / 2.5) * 1000;

  // Energía declarada. Solo se leen los dos campos con unidad explícita:
  // `energy_100g` a secas cambia de unidad según la ficha y no es de fiar.
  const kcalOFF = num(n["energy-kcal_100g"]);
  const kjOFF = num(n["energy-kj_100g"]);
  const kcalRef = kcalOFF ?? (kjOFF !== null ? kjOFF / 4.184 : null);

  const faltanTodos = prot === null && hc === null && grasa === null;
  if (faltanTodos)
    avisos.push({
      clave: "sin_datos",
      gravedad: "alto",
      texto:
        "La ficha no trae composición: alguien dio de alta el producto pero no " +
        "llegó a copiar la tabla nutricional. Los valores están todos a cero y " +
        "hay que escribirlos a mano mirando el envase.",
    });

  const P = prot ?? 0;
  const H = hc ?? 0;
  const G = grasa ?? 0;
  const F = fibra ?? 0;
  const A = alcohol ?? 0;

  // ---------------------------------------------------- controles del dato --

  if (p.nutrition_data_per === "serving")
    avisos.push({
      clave: "por_racion",
      gravedad: "medio",
      texto:
        "En la ficha original los valores están por ración, no por 100 g. Los " +
        "de aquí los ha calculado Open Food Facts dividiendo por el tamaño de " +
        "la ración, así que si ese tamaño está mal, todo lo demás está mal.",
    });

  if (fibra === null && !faltanTodos)
    avisos.push({
      clave: "sin_fibra",
      gravedad: "medio",
      texto:
        "La ficha no declara fibra y se ha dejado en 0. En el etiquetado " +
        "europeo la fibra va aparte de los hidratos, así que los hidratos " +
        "siguen siendo correctos; lo único que falta es la fibra.",
    });

  // Más de 100 g de materia en 100 g de producto es imposible. No es un dato
  // discutible: es un dato mal metido.
  const suma = P + H + G + F + A + (salG ?? 0);
  if (suma > 100.5)
    avisos.push({
      clave: "suma_imposible",
      gravedad: "alto",
      texto:
        `Los nutrientes suman ${Math.round(suma)} g por cada 100 g de producto, ` +
        "que no puede ser. La ficha de Open Food Facts está mal: compruébalo " +
        "contra el envase antes de dar esto de alta.",
    });

  if (!faltanTodos && P === 0 && H === 0 && G === 0 && (kcalRef ?? 0) > 5)
    avisos.push({
      clave: "todo_cero",
      gravedad: "alto",
      texto:
        `Los tres macronutrientes están a cero y en cambio la etiqueta declara ` +
        `${Math.round(kcalRef!)} kcal. Una de las dos cosas está mal.`,
    });

  /**
   * El contraste que sale gratis: energía declarada contra energía calculada.
   *
   * `kcal_100` se calcula con Atwater a partir de los macros, y `kcal_ref`
   * guarda lo que dice el envase. Si las dos no se parecen, o los macros están
   * mal copiados o el producto lleva algo que Atwater no ve. Esto es lo que
   * convierte un dato de origen dudoso en un dato revisable.
   */
  const kcalAtwater = 4 * P + 4 * H + 9 * G + 7 * A;
  if (kcalRef !== null && kcalRef > 5 && !faltanTodos) {
    const desvio = Math.abs(kcalAtwater - kcalRef) / kcalRef;
    if (desvio > 0.1)
      avisos.push({
        clave: "desvio_kcal",
        gravedad: desvio > 0.25 ? "alto" : "medio",
        texto:
          `La etiqueta declara ${Math.round(kcalRef)} kcal/100 g y con estos ` +
          `macros salen ${Math.round(kcalAtwater)} (${Math.round(desvio * 100)}% ` +
          "de diferencia). Suele ser un macro mal copiado; en productos «sin " +
          "azúcar» o muy ricos en fibra puede ser real, porque los polialcoholes " +
          "y la fibra aportan menos energía de la que Atwater les supone.",
      });
  }

  // ------------------------------------------------------ nombre y estado --

  const nombre = nombreDelProducto(p);
  if (!nombre)
    avisos.push({
      clave: "sin_nombre",
      gravedad: "alto",
      texto: "La ficha no tiene nombre. Ponle uno antes de guardar.",
    });

  const categorias = p.categories_tags ?? [];
  const seco = categorias.some((c) => CATEGORIAS_SECAS.includes(c));
  const estado: EstadoIngrediente = seco ? "seco" : "listo";
  if (seco)
    avisos.push({
      clave: "estado_seco",
      gravedad: "medio",
      texto:
        "Parece pasta, arroz o harina: los valores del envase son del producto " +
        "seco, no cocinado. Se ha marcado como «seco o deshidratado», pero si " +
        "tus dietas están escritas en cocido, los gramos no son los mismos.",
    });

  let grupo: string | null = null;
  for (const [tag, g] of GRUPOS_OFF)
    if (categorias.includes(tag)) {
      grupo = g;
      break;
    }

  // ---------------------------------------------------------- alérgenos --

  const traducir = (tags: string[] | undefined) => {
    const conocidos = new Set<string>();
    const sueltos: string[] = [];
    for (const t of tags ?? []) {
      const c = ALERGENOS_OFF[t];
      if (c) conocidos.add(c);
      else sueltos.push(t.replace(/^[a-z]{2}:/, "").replace(/-/g, " "));
    }
    return { conocidos: [...conocidos], sueltos };
  };

  const contiene = traducir(p.allergens_tags);
  const trazas = traducir(p.traces_tags);

  const sueltos = [...new Set([...contiene.sueltos, ...trazas.sueltos])];
  if (sueltos.length)
    avisos.push({
      clave: "alergeno_sin_equivalencia",
      gravedad: "medio",
      texto:
        `La etiqueta declara además ${sueltos.join(", ")}, que no está entre los ` +
        "catorce del Anexo II y por eso no se marca solo. Si te importa, " +
        "decláralo como alérgeno propio y asígnalo desde la ficha.",
    });

  // Lo que ya está declarado como contenido no se repite en trazas.
  const soloTrazas = trazas.conocidos.filter((c) => !contiene.conocidos.includes(c));

  // ----------------------------------------------------------------- notas --

  const fecha = hoy.toLocaleDateString("es-ES");
  const cantidad = (p.quantity ?? "").trim();

  return {
    nombre,
    grupo,
    estado,
    prot_100: r3(P),
    hc_100: r3(H),
    grasa_100: r3(G),
    fibra_100: r3(F),
    alcohol_100: r3(A),
    // OFF no trae agua, y la porción comestible de un envasado no la sabe
    // nadie: null es «no lo sé», que no es lo mismo que cero ni que uno.
    agua_100: null,
    ags_100: ags === null ? null : r3(ags),
    sodio_100: sodio === null ? null : r3(sodio),
    porcion_comestible: null,
    notas:
      `Alta por código de barras ${codigo}${cantidad ? ` · envase de ${cantidad}` : ""}. ` +
      `Datos de Open Food Facts (ODbL), consultados el ${fecha}. Sin revisar.` +
      (sodioDesdeSal ? ` Sodio calculado desde la sal declarada (${salG} g ÷ 2,5).` : "") +
      // Cuáles eran trazas y cuáles contenido se pierde al guardarlos, porque
      // `ingrediente_alergenos` no distingue: aquí queda escrito.
      (soloTrazas.length ? ` Declarado solo como trazas: ${soloTrazas.join(", ")}.` : ""),
    codigo_barras: codigo,
    kcal_ref: kcalRef === null ? null : r3(kcalRef),
    alergenos: contiene.conocidos,
    trazas: soloTrazas,
    avisos,
  };
}

/** ¿Hay algo que obligue a mirar esto con cuidado antes de guardarlo? */
export const hayAvisoGrave = (avisos: Aviso[]) => avisos.some((a) => a.gravedad === "alto");
