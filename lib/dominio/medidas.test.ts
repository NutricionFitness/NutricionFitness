import { describe, expect, it } from "vitest";

import {
  conversionDisponible,
  enMedidas,
  estadosIncoherentes,
  etiquetaMedida,
  nombreMedida,
  medidaPorDefecto,
  type Equivalencia,
  type Medida,
} from "./medidas";

const m = (nombre: string, gramos: number, owner: string | null = null): Medida => ({
  id: nombre,
  nombre,
  gramos,
  owner_id: owner,
});

const HUEVO = [m("unidad (M)", 53)];
const ACEITE = [m("cucharada", 9)];

describe("etiqueta de medida", () => {
  it("traduce los casos limpios", () => {
    expect(etiquetaMedida(53, HUEVO)).toBe("1 unidad (M)");
    expect(etiquetaMedida(106, HUEVO)).toBe("2 unidades (M)");
    expect(etiquetaMedida(159, HUEVO)).toBe("3 unidades (M)");
  });

  it("admite medios", () => {
    expect(etiquetaMedida(79.5, HUEVO)).toBe("1½ unidades (M)");
    expect(etiquetaMedida(27, HUEVO)).toBe("½ unidad (M)");
  });

  it("no inventa cuando la cantidad no cuadra", () => {
    // 72 g no son «1 unidad» ni «1½»: mejor callarse y enseñar los gramos.
    expect(etiquetaMedida(72, HUEVO)).toBeNull();
    expect(etiquetaMedida(40, HUEVO)).toBeNull();
  });

  it("tolera pequeñas desviaciones, que es lo que deja un ajuste", () => {
    // el motor redondea a pasos de 5 g: 105 en vez de 106
    expect(etiquetaMedida(105, HUEVO)).toBe("2 unidades (M)");
  });

  it("no se estira a cantidades absurdas", () => {
    expect(etiquetaMedida(2000, HUEVO)).toBeNull();  // 37 huevos
    expect(etiquetaMedida(10, HUEVO)).toBeNull();    // menos de medio
  });

  it("elige la medida que mejor encaja", () => {
    const varias = [m("cucharada", 9), m("cucharadita", 4.5)];
    expect(etiquetaMedida(9, varias)).toBe("1 cucharada");
    expect(etiquetaMedida(4.5, varias)).toBe("1 cucharadita");
  });

  it("sin medidas o con cantidades imposibles devuelve null", () => {
    expect(etiquetaMedida(100, [])).toBeNull();
    expect(etiquetaMedida(100, null)).toBeNull();
    expect(etiquetaMedida(0, HUEVO)).toBeNull();
    expect(etiquetaMedida(-5, HUEVO)).toBeNull();
    expect(etiquetaMedida(100, [m("rota", 0)])).toBeNull();
  });

  it("enMedidas hace la cuenta cruda", () => {
    expect(enMedidas(106, HUEVO[0])).toBeCloseTo(2, 9);
    expect(enMedidas(100, m("rota", 0))).toBe(0);
  });

  it("la medida propia manda sobre la de serie", () => {
    const mezcla = [m("unidad (M)", 53), m("mi huevo", 60, "u1")];
    expect(medidaPorDefecto(mezcla)!.nombre).toBe("mi huevo");
    expect(medidaPorDefecto(HUEVO)!.nombre).toBe("unidad (M)");
    expect(medidaPorDefecto([])).toBeNull();
  });
});

describe("conversión crudo ↔ cocido", () => {
  // 100 g de arroz crudo dan 300 g cocido
  const EQ: Equivalencia[] = [
    { ingrediente_crudo_id: 1, ingrediente_cocido_id: 2, factor: 3, agua_crudo: 12, agua_cocido: 70 },
  ];

  it("de crudo a cocido multiplica", () => {
    const c = conversionDisponible(1, 80, EQ)!;
    expect(c.haciaCocido).toBe(true);
    expect(c.ingredienteDestino).toBe(2);
    expect(c.gramosDestino).toBe(240);
  });

  it("de cocido a crudo divide", () => {
    const c = conversionDisponible(2, 240, EQ)!;
    expect(c.haciaCocido).toBe(false);
    expect(c.ingredienteDestino).toBe(1);
    expect(c.gramosDestino).toBe(80);
  });

  it("ida y vuelta devuelve el punto de partida", () => {
    const ida = conversionDisponible(1, 80, EQ)!;
    const vuelta = conversionDisponible(2, ida.gramosDestino, EQ)!;
    expect(vuelta.gramosDestino).toBeCloseTo(80, 6);
  });

  it("sin equivalencia no ofrece nada, que es lo normal", () => {
    expect(conversionDisponible(99, 100, EQ)).toBeNull();
    expect(conversionDisponible(1, 100, [])).toBeNull();
    expect(conversionDisponible(1, 100, null)).toBeNull();
  });
});

describe("aviso de estados mezclados", () => {
  it("avisa si la dieta va en crudo y hay cocidos", () => {
    const r = estadosIncoherentes("crudo", ["crudo", "cocido", "desconocido", "cocido"]);
    expect(r).toEqual([{ estado: "cocido", n: 2 }]);
  });

  it("y al revés", () => {
    expect(estadosIncoherentes("cocido", ["crudo", "cocido"])).toEqual([
      { estado: "crudo", n: 1 },
    ]);
  });

  it("no avisa cuando todo cuadra ni cuando la dieta es mixta", () => {
    expect(estadosIncoherentes("crudo", ["crudo", "desconocido"])).toEqual([]);
    expect(estadosIncoherentes("mixto", ["crudo", "cocido"])).toEqual([]);
  });

  it("«desconocido» nunca dispara el aviso", () => {
    // el 63% del catálogo no declara estado: avisar por eso sería ruido puro
    expect(estadosIncoherentes("crudo", ["desconocido", "desconocido"])).toEqual([]);
  });
});

describe("concordancia del nombre de la medida", () => {
  it("en singular no toca nada", () => {
    expect(nombreMedida("unidad (M)", 1)).toBe("unidad (M)");
    expect(nombreMedida("cucharada", 0.5)).toBe("cucharada");
  });

  it("pluraliza todo el vocabulario que carga el script de medidas", () => {
    const casos: Array<[string, string]> = [
      ["unidad", "unidades"],
      ["unidad (M)", "unidades (M)"],
      ["unidad mediana", "unidades medianas"],
      ["vaso (200 ml)", "vasos (200 ml)"],
      ["taza (125 ml)", "tazas (125 ml)"],
      ["caña (200 ml)", "cañas (200 ml)"],
      ["copa (100 ml)", "copas (100 ml)"],
      ["cucharada", "cucharadas"],
      ["cucharadita", "cucharaditas"],
      ["loncha", "lonchas"],
      ["rebanada", "rebanadas"],
      ["puñado", "puñados"],
      ["onza", "onzas"],
      ["porción", "porciones"],
      ["ración (en crudo)", "raciones (en crudo)"],
      ["cazo (en seco)", "cazos (en seco)"],
      ["cazo (en crudo)", "cazos (en crudo)"],
      ["lata escurrida", "latas escurridas"],
      ["clara de 1 huevo", "claras de huevo"],
      ["yema de 1 huevo", "yemas de huevo"],
    ];
    for (const [uno, varios] of casos) {
      expect(nombreMedida(uno, 2), uno).toBe(varios);
    }
  });

  it("el «1» de «de 1 huevo» también sobra en singular", () => {
    expect(nombreMedida("clara de 1 huevo", 1)).toBe("clara de huevo");
  });

  it("no pluraliza lo que va detrás de una preposición", () => {
    // «cazos en seco», no «cazos en secos»
    expect(nombreMedida("cazo en seco", 3)).toBe("cazos en seco");
    expect(nombreMedida("taza de café", 2)).toBe("tazas de café");
  });

  it("las reglas raras del español, que las hay", () => {
    expect(nombreMedida("nuez", 2)).toBe("nueces");   // -z → -ces
    expect(nombreMedida("cucharón", 2)).toBe("cucharones"); // pierde la tilde
    expect(nombreMedida("crisis", 2)).toBe("crisis"); // invariable
  });

  it("un medio ya pide plural: «1½ vasos», no «1½ vaso»", () => {
    expect(nombreMedida("vaso (200 ml)", 1.5)).toBe("vasos (200 ml)");
  });
});
