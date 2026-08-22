import { describe, expect, it } from "vitest";

import { ESTADOS } from "@/app/ingredientes/tipos";
import {
  convertir,
  hayAvisoGrave,
  nombreDelProducto,
  type EstadoIngrediente,
  type ProductoOFF,
} from "./convertir";

/**
 * `lib/openfoodfacts` no importa de `app/` para no atarse a ella, así que
 * repite la lista de estados. Esto es lo que impide que las dos se separen: si
 * alguien añade un estado a `ESTADOS` y no aquí —o al revés—, `tsc` falla en
 * esta línea, que es antes de que nadie lo note en producción.
 */
type IgualQue<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const MISMOS_ESTADOS: IgualQue<EstadoIngrediente, (typeof ESTADOS)[number]> = true;

const EAN = "3017620422003";
const HOY = new Date(2026, 7, 22); // 22/8/2026, fijo para poder mirar las notas

/** Un yogur natural sin nada raro: el caso que debe pasar limpio. */
const YOGUR: ProductoOFF = {
  product_name_es: "Yogur natural",
  brands: "Hacendado",
  quantity: "4 x 125 g",
  nutrition_data_per: "100g",
  categories_tags: ["en:dairies", "en:fermented-foods", "en:yogurts"],
  allergens_tags: ["en:milk"],
  nutriments: {
    "energy-kcal_100g": 63,
    proteins_100g: 3.8,
    carbohydrates_100g: 4.9,
    fat_100g: 3.2,
    fiber_100g: 0,
    "saturated-fat_100g": 2.1,
    salt_100g: 0.13,
  },
};

/** Claves de los avisos que ha soltado una conversión. */
const claves = (p: { avisos: { clave: string }[] }) => p.avisos.map((a) => a.clave);

describe("el caso limpio", () => {
  const p = convertir(YOGUR, EAN, HOY);

  it("lleva los macros a sus columnas tal cual", () => {
    expect(p.prot_100).toBe(3.8);
    expect(p.hc_100).toBe(4.9);
    expect(p.grasa_100).toBe(3.2);
    expect(p.fibra_100).toBe(0);
    expect(p.alcohol_100).toBe(0);
    expect(p.ags_100).toBe(2.1);
  });

  it("la energía declarada va a kcal_ref, no a los macros", () => {
    // `kcal_100` es una columna generada: mandar kilocalorías sería inventar
    // una segunda verdad para el mismo dato.
    expect(p.kcal_ref).toBe(63);
  });

  it("no se queja de nada", () => {
    expect(p.avisos).toEqual([]);
    expect(hayAvisoGrave(p.avisos)).toBe(false);
  });

  it("deja el rastro de dónde salió", () => {
    expect(p.codigo_barras).toBe(EAN);
    expect(p.notas).toContain(EAN);
    expect(p.notas).toContain("Open Food Facts");
    expect(p.notas).toContain("22/8/2026");
    expect(p.notas).toContain("4 x 125 g");
  });

  it("no inventa lo que no sabe", () => {
    // La porción comestible de un envasado no la sabe nadie, y OFF no trae
    // agua. Null es «no lo sé», que no es cero ni uno.
    expect(p.agua_100).toBeNull();
    expect(p.porcion_comestible).toBeNull();
  });
});

describe("el nombre", () => {
  it("junta producto y marca", () => {
    expect(nombreDelProducto(YOGUR)).toBe("Yogur natural (Hacendado)");
  });

  it("no repite la marca si ya está dentro del nombre", () => {
    expect(
      nombreDelProducto({ product_name: "Yogur Hacendado desnatado", brands: "Hacendado" }),
    ).toBe("Yogur Hacendado desnatado");
    // Y tampoco con las tildes o las mayúsculas cambiadas.
    expect(nombreDelProducto({ product_name: "Café LA ESTRELLA", brands: "La Estrella" })).toBe(
      "Café LA ESTRELLA",
    );
  });

  it("se queda con la primera marca cuando hay varias", () => {
    expect(nombreDelProducto({ product_name: "Galletas", brands: "Fontaneda, Mondelez" })).toBe(
      "Galletas (Fontaneda)",
    );
  });

  it("prefiere el castellano y cae al genérico", () => {
    expect(nombreDelProducto({ product_name: "Tuna", product_name_es: "Atún" })).toBe("Atún");
    expect(nombreDelProducto({ generic_name_es: "Leche entera" })).toBe("Leche entera");
  });

  it("sin nombre, avisa fuerte", () => {
    const p = convertir({ nutriments: { proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1 } }, EAN, HOY);
    expect(p.nombre).toBe("");
    expect(claves(p)).toContain("sin_nombre");
    expect(hayAvisoGrave(p.avisos)).toBe(true);
  });
});

describe("sodio y sal", () => {
  it("el sodio de OFF viene en gramos y la columna está en miligramos", () => {
    const p = convertir(
      { ...YOGUR, nutriments: { ...YOGUR.nutriments, sodium_100g: 0.052 } },
      EAN,
      HOY,
    );
    expect(p.sodio_100).toBe(52);
    expect(p.notas).not.toContain("÷ 2,5");
  });

  it("si solo hay sal, se divide por 2,5", () => {
    const p = convertir(YOGUR, EAN, HOY);
    // 0,13 g de sal ÷ 2,5 = 0,052 g de sodio = 52 mg
    expect(p.sodio_100).toBe(52);
    // Sin aviso: la conversión es exacta y saltaría en casi todas las etiquetas
    // europeas, que declaran sal y no sodio. Queda dicho en las notas.
    expect(p.avisos).toEqual([]);
    expect(p.notas).toContain("÷ 2,5");
  });

  it("sin sal ni sodio se queda a null", () => {
    const { salt_100g: _, ...sinSal } = YOGUR.nutriments!;
    const p = convertir({ ...YOGUR, nutriments: sinSal }, EAN, HOY);
    expect(p.sodio_100).toBeNull();
  });
});

describe("el alcohol, que viene en grados", () => {
  const VINO: ProductoOFF = {
    product_name_es: "Vino tinto",
    categories_tags: ["en:alcoholic-beverages"],
    nutriments: {
      "energy-kcal_100g": 83,
      proteins_100g: 0.1,
      carbohydrates_100g: 2.6,
      fat_100g: 0,
      alcohol_100g: 12,
      alcohol_unit: "% vol",
    },
  };

  it("convierte % vol a gramos antes de guardarlo", () => {
    // Copiar el 12 como si fueran gramos metería 84 kcal de alcohol donde hay
    // 66: un 27% de más en la energía de este ingrediente, y `kcal_100` es una
    // columna generada, así que el error no se vería en ninguna parte.
    const p = convertir(VINO, EAN, HOY);
    expect(p.alcohol_100).toBeCloseTo(9.468, 3);
    expect(claves(p)).toContain("alcohol_por_volumen");
  });

  it("respeta los gramos cuando la ficha dice que son gramos", () => {
    const p = convertir(
      { ...VINO, nutriments: { ...VINO.nutriments, alcohol_unit: "g" } },
      EAN,
      HOY,
    );
    expect(p.alcohol_100).toBe(12);
    expect(claves(p)).not.toContain("alcohol_por_volumen");
  });

  it("sin alcohol no se inventa la conversión", () => {
    expect(claves(convertir(YOGUR, EAN, HOY))).not.toContain("alcohol_por_volumen");
  });
});

describe("los controles del dato, que es para lo que sirve esto", () => {
  it("caza el desvío entre la energía declarada y la calculada", () => {
    const malo: ProductoOFF = {
      ...YOGUR,
      nutriments: { "energy-kcal_100g": 100, proteins_100g: 10, carbohydrates_100g: 10, fat_100g: 10 },
    };
    const p = convertir(malo, EAN, HOY);
    // Atwater da 170 sobre 100 declaradas: 70% de diferencia.
    expect(claves(p)).toContain("desvio_kcal");
    expect(p.avisos.find((a) => a.clave === "desvio_kcal")!.gravedad).toBe("alto");
  });

  it("un desvío pequeño no molesta", () => {
    // El yogur limpio da 63,6 calculadas contra 63 declaradas: 1%.
    expect(claves(convertir(YOGUR, EAN, HOY))).not.toContain("desvio_kcal");
  });

  it("un desvío medio avisa sin alarmar", () => {
    const p = convertir(
      { ...YOGUR, nutriments: { ...YOGUR.nutriments, "energy-kcal_100g": 55 } },
      EAN,
      HOY,
    );
    // 63,6 contra 55: 15,6%.
    expect(p.avisos.find((a) => a.clave === "desvio_kcal")!.gravedad).toBe("medio");
    expect(hayAvisoGrave(p.avisos)).toBe(false);
  });

  it("caza los nutrientes que suman más de 100 g por cada 100 g", () => {
    const p = convertir(
      {
        ...YOGUR,
        nutriments: { proteins_100g: 40, carbohydrates_100g: 40, fat_100g: 40, "energy-kcal_100g": 680 },
      },
      EAN,
      HOY,
    );
    expect(claves(p)).toContain("suma_imposible");
    expect(hayAvisoGrave(p.avisos)).toBe(true);
  });

  it("caza la ficha vacía con energía declarada", () => {
    const p = convertir(
      {
        ...YOGUR,
        nutriments: { proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0, "energy-kcal_100g": 250 },
      },
      EAN,
      HOY,
    );
    expect(claves(p)).toContain("todo_cero");
  });

  it("el agua embotellada no es una ficha vacía", () => {
    const p = convertir(
      {
        product_name_es: "Agua mineral",
        categories_tags: ["en:waters"],
        nutriments: { proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0, "energy-kcal_100g": 0 },
      },
      EAN,
      HOY,
    );
    expect(claves(p)).not.toContain("todo_cero");
    expect(claves(p)).not.toContain("sin_datos");
  });

  it("sin composición ninguna, lo dice y no finge ceros", () => {
    const p = convertir({ product_name_es: "Algo", nutriments: {} }, EAN, HOY);
    expect(claves(p)).toContain("sin_datos");
    expect(hayAvisoGrave(p.avisos)).toBe(true);
    // Los campos son obligatorios en la base, así que van a cero; el aviso es
    // lo que impide que ese cero pase por un dato.
    expect(p.prot_100).toBe(0);
  });

  it("distingue «no declara fibra» de «no tiene fibra»", () => {
    const { fiber_100g: _, ...sinFibra } = YOGUR.nutriments!;
    expect(claves(convertir({ ...YOGUR, nutriments: sinFibra }, EAN, HOY))).toContain("sin_fibra");
    expect(claves(convertir(YOGUR, EAN, HOY))).not.toContain("sin_fibra");
  });

  it("avisa cuando la ficha original estaba por ración", () => {
    const p = convertir({ ...YOGUR, nutrition_data_per: "serving" }, EAN, HOY);
    expect(claves(p)).toContain("por_racion");
  });

  it("saca las kcal de los kJ si hace falta", () => {
    const { "energy-kcal_100g": _, ...sinKcal } = YOGUR.nutriments!;
    const p = convertir(
      { ...YOGUR, nutriments: { ...sinKcal, "energy-kj_100g": 264 } },
      EAN,
      HOY,
    );
    expect(p.kcal_ref).toBeCloseTo(63.098, 2);
  });

  it("aguanta los números que OFF manda como texto", () => {
    const p = convertir(
      { ...YOGUR, nutriments: { ...YOGUR.nutriments, proteins_100g: "3.8", fat_100g: "3,2" } },
      EAN,
      HOY,
    );
    expect(p.prot_100).toBe(3.8);
    expect(p.grasa_100).toBe(3.2);
  });
});

describe("alérgenos", () => {
  it("traduce las catorce etiquetas del Anexo II", () => {
    const p = convertir(
      { ...YOGUR, allergens_tags: ["en:milk", "en:gluten", "en:soybeans", "en:nuts"] },
      EAN,
      HOY,
    );
    expect(p.alergenos.sort()).toEqual(["frutos_cascara", "gluten", "leche", "soja"]);
  });

  it("entiende las variantes que salen en fichas reales", () => {
    // Muchas fichas concretan el cereal o el fruto seco en vez de usar la
    // etiqueta genérica. Sin esto se escaparían.
    const p = convertir(
      { ...YOGUR, allergens_tags: ["en:wheat", "en:oats", "en:almonds", "en:sesame"] },
      EAN,
      HOY,
    );
    expect(p.alergenos.sort()).toEqual(["frutos_cascara", "gluten", "sesamo"]);
  });

  it("las trazas van aparte, no mezcladas con lo que lleva", () => {
    const p = convertir(
      { ...YOGUR, allergens_tags: ["en:milk"], traces_tags: ["en:nuts", "en:milk"] },
      EAN,
      HOY,
    );
    expect(p.alergenos).toEqual(["leche"]);
    // La leche ya está declarada como contenida: no se repite en trazas.
    expect(p.trazas).toEqual(["frutos_cascara"]);
  });

  it("lo que declara la etiqueta y no está en el Anexo II se dice, no se calla", () => {
    // El piñón es alérgeno frecuente y NO está en la lista cerrada de frutos de
    // cáscara. Marcarlo como tal contradiría la tabla curada; callárselo sería
    // avisar de menos, que es lo que hace daño.
    const p = convertir({ ...YOGUR, allergens_tags: ["en:milk", "en:pine-nuts"] }, EAN, HOY);
    expect(p.alergenos).toEqual(["leche"]);
    const aviso = p.avisos.find((a) => a.clave === "alergeno_sin_equivalencia")!;
    expect(aviso.texto).toContain("pine nuts");
  });

  it("sin alérgenos declarados no marca nada", () => {
    const p = convertir({ ...YOGUR, allergens_tags: [] }, EAN, HOY);
    expect(p.alergenos).toEqual([]);
    expect(p.trazas).toEqual([]);
    expect(claves(p)).not.toContain("alergeno_sin_equivalencia");
  });
});

describe("estado y grupo", () => {
  it("los estados que devuelve son de los que admite la base", () => {
    expect(MISMOS_ESTADOS).toBe(true);
    for (const p of [YOGUR, {}, { categories_tags: ["en:pastas"] }])
      expect(ESTADOS).toContain(convertir(p, EAN, HOY).estado);
  });

  it("un envasado normal está listo para comer", () => {
    expect(convertir(YOGUR, EAN, HOY).estado).toBe("listo");
  });

  it("la pasta y el arroz van en seco, y se avisa", () => {
    const p = convertir(
      { product_name_es: "Macarrones", categories_tags: ["en:cereals-and-potatoes", "en:pastas"] },
      EAN,
      HOY,
    );
    expect(p.estado).toBe("seco");
    expect(claves(p)).toContain("estado_seco");
  });

  it("adivina el grupo cuando es evidente", () => {
    expect(convertir(YOGUR, EAN, HOY).grupo).toBe("Lácteos");
    expect(
      convertir({ categories_tags: ["en:plant-based-foods", "en:legumes"] }, EAN, HOY).grupo,
    ).toBe("Legumbres");
  });

  it("y lo deja en blanco cuando no lo es", () => {
    expect(convertir({ categories_tags: ["en:snacks", "en:cosas-raras"] }, EAN, HOY).grupo).toBeNull();
    expect(convertir({}, EAN, HOY).grupo).toBeNull();
  });

  it("gana la categoría más específica", () => {
    // La pasta lleva `en:cereals-and-potatoes` y `en:pastas` a la vez, y las
    // dos apuntan a «Cereales y derivados»: lo que importa es que no se cuele
    // por otra familia.
    const p = convertir(
      { categories_tags: ["en:cereals-and-potatoes", "en:pastas"] },
      EAN,
      HOY,
    );
    expect(p.grupo).toBe("Cereales y derivados");
  });
});

describe("nada de esto revienta con una ficha rota", () => {
  it("una ficha completamente vacía sale sin lanzar", () => {
    const p = convertir({}, EAN, HOY);
    expect(p.nombre).toBe("");
    expect(p.prot_100).toBe(0);
    expect(p.codigo_barras).toBe(EAN);
  });

  it("números imposibles se descartan en vez de guardarse", () => {
    const p = convertir(
      {
        ...YOGUR,
        nutriments: { proteins_100g: -5, carbohydrates_100g: "no sé", fat_100g: null, fiber_100g: 1 },
      },
      EAN,
      HOY,
    );
    expect(p.prot_100).toBe(0);
    expect(p.hc_100).toBe(0);
    expect(p.grasa_100).toBe(0);
    expect(claves(p)).toContain("sin_datos");
  });
});
