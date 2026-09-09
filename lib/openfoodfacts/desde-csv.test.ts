import { describe, expect, it } from "vitest";

import { convertir, hayAvisoGrave } from "./convertir";
import {
  COLUMNAS_NECESARIAS,
  esAlcoholico,
  filaAProducto,
  fueraDeRango,
  indiceDeCabecera,
} from "./desde-csv";

/**
 * Las columnas del CSV que se usan, en el orden en que aparecen de verdad en el
 * export. No están las 211: están las que toca el adaptador más un par de
 * intrusas en medio, para que la prueba falle si alguien vuelve a leer por
 * posición en vez de por nombre.
 */
const CABECERA = [
  "code",
  "url",
  "product_name",
  "generic_name",
  "quantity",
  "brands",
  "categories_tags",
  "countries_tags",
  "allergens",
  "allergens_en",
  "traces",
  "traces_tags",
  "serving_size",
  "no_nutrition_data",
  "last_modified_t",
  "energy-kj_100g",
  "energy-kcal_100g",
  "fat_100g",
  "saturated-fat_100g",
  "carbohydrates_100g",
  "fiber_100g",
  "proteins_100g",
  "salt_100g",
  "sodium_100g",
  "alcohol_100g",
].join("\t");

const idx = indiceDeCabecera(CABECERA);

/** Una fila, escrita por nombre de columna para que se lea. */
function fila(valores: Record<string, string>): string[] {
  const cols = CABECERA.split("\t");
  return cols.map((c) => valores[c] ?? "");
}

const YOGUR = fila({
  code: "8410179000015",
  product_name: "Yogur natural",
  brands: "Hacendado",
  quantity: "4 x 125 g",
  categories_tags: "en:dairies,en:fermented-foods,en:yogurts",
  countries_tags: "en:spain",
  allergens: "en:milk",
  traces_tags: "en:nuts",
  last_modified_t: "1780000000",
  "energy-kcal_100g": "61",
  fat_100g: "3.2",
  "saturated-fat_100g": "2.1",
  carbohydrates_100g: "4.8",
  fiber_100g: "0",
  proteins_100g: "3.5",
  salt_100g: "0.13",
});

describe("indiceDeCabecera", () => {
  it("resuelve las columnas por nombre", () => {
    expect(idx["proteins_100g"]).toBe(CABECERA.split("\t").indexOf("proteins_100g"));
  });

  it("revienta diciendo cuál falta, en vez de leer el campo de al lado", () => {
    const sinProteinas = CABECERA.split("\t").filter((c) => c !== "proteins_100g").join("\t");
    expect(() => indiceDeCabecera(sinProteinas)).toThrow(/proteins_100g/);
  });

  it("las columnas necesarias son las cinco que dice", () => {
    expect(COLUMNAS_NECESARIAS).toHaveLength(5);
  });
});

describe("filaAProducto", () => {
  it("una fila sin código no es un producto", () => {
    expect(filaAProducto(fila({ product_name: "Cosa" }), idx)).toBeNull();
  });

  it("lleva los macros al sitio donde el conversor los busca", () => {
    const f = filaAProducto(YOGUR, idx)!;
    expect(f.codigo).toBe("8410179000015");
    expect(f.paises).toEqual(["en:spain"]);
    expect(f.modificado).toBe(1780000000);
    expect(f.producto.nutriments).toMatchObject({
      proteins_100g: 3.5,
      carbohydrates_100g: 4.8,
      fat_100g: 3.2,
      fiber_100g: 0,
      "saturated-fat_100g": 2.1,
      salt_100g: 0.13,
      "energy-kcal_100g": 61,
    });
  });

  it("un campo vacío es ausencia, no un cero", () => {
    const sinFibra = filaAProducto(fila({ ...aObjeto(YOGUR), fiber_100g: "" }), idx)!;
    expect(sinFibra.producto.nutriments).not.toHaveProperty("fiber_100g");
    // Y el conversor lo nota: ese es justo el aviso `sin_fibra`.
    const p = convertir(sinFibra.producto, sinFibra.codigo);
    expect(p.avisos.map((a) => a.clave)).toContain("sin_fibra");
  });

  it("los alérgenos salen de `allergens`, que es donde están", () => {
    const f = filaAProducto(YOGUR, idx)!;
    expect(f.producto.allergens_tags).toEqual(["en:milk"]);
    expect(f.producto.traces_tags).toEqual(["en:nuts"]);
  });

  it("`en:none` no es un alérgeno", () => {
    const f = filaAProducto(fila({ ...aObjeto(YOGUR), allergens: "en:none" }), idx)!;
    expect(f.producto.allergens_tags).toEqual([]);
  });

  it("una etiqueta sin equivalencia pasa, para que el conversor avise", () => {
    const f = filaAProducto(fila({ ...aObjeto(YOGUR), allergens: "it:Aloe,en:milk" }), idx)!;
    expect(f.producto.allergens_tags).toEqual(["it:aloe", "en:milk"]);
    const p = convertir(f.producto, f.codigo);
    expect(p.avisos.map((a) => a.clave)).toContain("alergeno_sin_equivalencia");
    expect(p.alergenos).toContain("leche");
  });

  it("el alcohol se queda fuera por defecto", () => {
    const vino = fila({
      ...aObjeto(YOGUR),
      code: "3017620422003",
      alcohol_100g: "13",
      proteins_100g: "0.1",
      carbohydrates_100g: "2.6",
      fat_100g: "0",
    });
    expect(esAlcoholico(vino, idx)).toBe(true);
    expect(filaAProducto(vino, idx)!.producto.nutriments).not.toHaveProperty("alcohol_100g");

    // Y con `incluirAlcohol`, se lee como % vol: 13 → 10,26 g, no 13 g.
    const conAlcohol = filaAProducto(vino, idx, { incluirAlcohol: true })!;
    const p = convertir(conAlcohol.producto, conAlcohol.codigo);
    expect(p.alcohol_100).toBeCloseTo(13 * 0.789, 2);
    expect(p.avisos.map((a) => a.clave)).toContain("alcohol_por_volumen");
  });

  it("un producto sin alcohol no es alcohólico aunque la columna esté a cero", () => {
    expect(esAlcoholico(fila({ ...aObjeto(YOGUR), alcohol_100g: "0" }), idx)).toBe(false);
    expect(esAlcoholico(YOGUR, idx)).toBe(false);
  });
});

describe("de punta a punta, con el conversor de la fase 14", () => {
  it("el yogur sale entero y sin avisos graves", () => {
    const f = filaAProducto(YOGUR, idx)!;
    const p = convertir(f.producto, f.codigo);

    expect(p.nombre).toBe("Yogur natural (Hacendado)");
    expect(p.grupo).toBe("Lácteos");
    expect(p.estado).toBe("listo");
    expect(p.prot_100).toBe(3.5);
    expect(p.kcal_ref).toBe(61);
    // La sal se convierte a sodio en miligramos: 0,13 / 2,5 × 1000 = 52.
    expect(p.sodio_100).toBeCloseTo(52, 0);
    // Trazas y contenido se marcan igual, que es la decisión de `alergias.md`.
    expect(p.alergenos).toContain("leche");
    expect(p.trazas).toContain("frutos_cascara");
    expect(hayAvisoGrave(p.avisos)).toBe(false);
  });

  it("la pasta se marca como seca por sus categorías", () => {
    const f = filaAProducto(
      fila({
        ...aObjeto(YOGUR),
        code: "8076809513722",
        product_name: "Macarrones",
        brands: "Gallo",
        categories_tags: "en:cereals-and-potatoes,en:pastas",
        proteins_100g: "12",
        carbohydrates_100g: "72",
        fat_100g: "1.5",
        "energy-kcal_100g": "356",
      }),
      idx,
    )!;
    const p = convertir(f.producto, f.codigo);
    expect(p.estado).toBe("seco");
    expect(p.avisos.map((a) => a.clave)).toContain("estado_seco");
  });

  it("una ficha imposible se marca grave, para que la carga la descarte", () => {
    const f = filaAProducto(
      fila({
        ...aObjeto(YOGUR),
        proteins_100g: "60",
        carbohydrates_100g: "60",
        fat_100g: "40",
      }),
      idx,
    )!;
    const p = convertir(f.producto, f.codigo);
    expect(p.avisos.map((a) => a.clave)).toContain("suma_imposible");
    expect(hayAvisoGrave(p.avisos)).toBe(true);
  });

  it("sin `nutrition_data_per`, el aviso por ración NO se levanta", () => {
    // No es un descuido: el CSV no trae esa columna. La prueba está para que si
    // algún día la añaden y alguien la mapea, esto se ponga rojo y se revise la
    // frase de las notas que dice que ese aviso no se puede dar.
    const f = filaAProducto(YOGUR, idx)!;
    expect(f.producto.nutrition_data_per).toBeUndefined();
    expect(convertir(f.producto, f.codigo).avisos.map((a) => a.clave)).not.toContain("por_racion");
  });
});

/** Deshace una fila a objeto, para poder escribir variantes sin repetir todo. */
function aObjeto(f: string[]): Record<string, string> {
  const cols = CABECERA.split("\t");
  return Object.fromEntries(cols.map((c, i) => [c, f[i] ?? ""]));
}

describe("fueraDeRango", () => {
  const bueno = {
    prot_100: 3.5, hc_100: 4.8, grasa_100: 3.2, fibra_100: 0, alcohol_100: 0,
    ags_100: 2.1, agua_100: null, sodio_100: 52, kcal_ref: 61,
  };

  it("un producto normal cabe", () => {
    expect(fueraDeRango(bueno)).toBeNull();
  });

  it("y el aceite puro también, que es el caso extremo de verdad", () => {
    expect(fueraDeRango({ ...bueno, grasa_100: 100, kcal_ref: 900 })).toBeNull();
  });

  it("más de 100 g de un nutriente en 100 g de producto, no", () => {
    expect(fueraDeRango({ ...bueno, prot_100: 101 })).toMatch(/proteína/);
    expect(fueraDeRango({ ...bueno, ags_100: 250 })).toMatch(/saturada/);
  });

  it("el sodio se mide en miligramos y tiene su propio tope", () => {
    expect(fueraDeRango({ ...bueno, sodio_100: 35_000 })).toBeNull(); // sal marina, real
    expect(fueraDeRango({ ...bueno, sodio_100: 4_000_000 })).toMatch(/sodio/);
  });

  it("una energía declarada imposible se caza antes de llegar a la base", () => {
    expect(fueraDeRango({ ...bueno, kcal_ref: 99999 })).toMatch(/energía/);
  });

  it("un NaN no se cuela", () => {
    expect(fueraDeRango({ ...bueno, prot_100: NaN })).toMatch(/proteína/);
  });
});
