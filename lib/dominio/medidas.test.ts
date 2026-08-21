import { describe, expect, it } from "vitest";

import {
  conversionDisponible,
  enMedidas,
  estadosIncoherentes,
  etiquetaMedida,
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
    expect(etiquetaMedida(106, HUEVO)).toBe("2 unidad (M)");
    expect(etiquetaMedida(159, HUEVO)).toBe("3 unidad (M)");
  });

  it("admite medios", () => {
    expect(etiquetaMedida(79.5, HUEVO)).toBe("1½ unidad (M)");
    expect(etiquetaMedida(27, HUEVO)).toBe("½ unidad (M)");
  });

  it("no inventa cuando la cantidad no cuadra", () => {
    // 72 g no son «1 unidad» ni «1½»: mejor callarse y enseñar los gramos.
    expect(etiquetaMedida(72, HUEVO)).toBeNull();
    expect(etiquetaMedida(40, HUEVO)).toBeNull();
  });

  it("tolera pequeñas desviaciones, que es lo que deja un ajuste", () => {
    // el motor redondea a pasos de 5 g: 105 en vez de 106
    expect(etiquetaMedida(105, HUEVO)).toBe("2 unidad (M)");
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
