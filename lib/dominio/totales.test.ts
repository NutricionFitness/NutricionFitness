import { describe, expect, it } from "vitest";

import { porKilo, totalesDe, type TresMacros } from "./totales";
import { energia, macros, porcentajes, type Componente, type Ingrediente } from "@/lib/motor";

const ing = (
  nombre: string,
  prot: number,
  hc: number,
  grasa: number,
  extra: Partial<Ingrediente> = {},
): Ingrediente => ({
  id: nombre.length,
  nombre,
  prot,
  hc,
  grasa,
  fibra: 0,
  alcohol: 0,
  kcalRef: null,
  grupo: null,
  estado: "crudo",
  ...extra,
});

const c = (i: Ingrediente, gramos: number, comida = "Comida"): Componente => ({
  ingrediente: i,
  gramos,
  comida,
});

const ARROZ = ing("Arroz", 7, 78, 0.6);
const ACEITE = ing("Aceite", 0, 0, 100);
const MERLUZA = ing("Merluza", 17, 0, 1.8);

describe("los totales de un trozo de dieta", () => {
  it("suman los gramos de cada macro", () => {
    const t = totalesDe([c(ARROZ, 100), c(ACEITE, 10)]);
    expect(t.macros.prot).toBeCloseTo(7, 6);
    expect(t.macros.hc).toBeCloseTo(78, 6);
    expect(t.macros.grasa).toBeCloseTo(0.6 + 10, 6);
  });

  it("la energía es la de Atwater sobre esos gramos", () => {
    const t = totalesDe([c(ARROZ, 100), c(ACEITE, 10)]);
    expect(t.energia).toBeCloseTo(4 * 7 + 4 * 78 + 9 * 10.6, 6);
  });

  it("el reparto suma 100", () => {
    const t = totalesDe([c(ARROZ, 100), c(ACEITE, 10), c(MERLUZA, 150)]);
    expect(t.pct.prot + t.pct.hc + t.pct.grasa).toBeCloseTo(100, 6);
  });

  it("sin componentes no inventa nada", () => {
    expect(totalesDe([])).toEqual({
      energia: 0,
      macros: { prot: 0, hc: 0, grasa: 0 },
      pct: { prot: 0, hc: 0, grasa: 0 },
    });
  });

  it("las comidas suman la dieta", () => {
    // Ésta es la propiedad que hace honesto enseñar un total por comida: si no
    // se cumpliera, la cabecera de cada comida diría una cosa y el total otra.
    const desayuno = [c(ARROZ, 60, "Desayuno")];
    const cena = [c(MERLUZA, 150, "Cena"), c(ACEITE, 10, "Cena")];
    const todo = [...desayuno, ...cena];

    const a = totalesDe(desayuno);
    const b = totalesDe(cena);
    const t = totalesDe(todo);

    expect(a.energia + b.energia).toBeCloseTo(t.energia, 6);
    for (const m of ["prot", "hc", "grasa"] as const)
      expect(a.macros[m] + b.macros[m]).toBeCloseTo(t.macros[m], 6);
  });

  it("usa el mismo motor que la dieta entera, no una copia", () => {
    // Si esto se separara, una comida podría calcularse con Atwater y su dieta
    // con la energía declarada, y los números dejarían de cuadrar.
    const comps = [c(ARROZ, 100), c(MERLUZA, 150)];
    const t = totalesDe(comps);
    const d = { componentes: comps, modeloEnergia: "atwater" as const };
    expect(t.energia).toBeCloseTo(energia(d), 9);
    expect(t.macros).toEqual(macros(d));
    expect(t.pct).toEqual(porcentajes(macros(d), energia(d)));
  });

  it("respeta el modelo de energía declarada", () => {
    const conRef = ing("Galleta", 7, 70, 15, { kcalRef: 450 });
    const atwater = totalesDe([c(conRef, 100)], "atwater");
    const declarada = totalesDe([c(conRef, 100)], "declarada");
    expect(declarada.energia).toBeCloseTo(450, 6);
    expect(atwater.energia).not.toBeCloseTo(450, 1);
  });
});

describe("gramos por kilo de peso", () => {
  const M: TresMacros = { prot: 200, hc: 250, grasa: 60 };

  it("divide entre el peso", () => {
    expect(porKilo(M, 100)).toEqual({ prot: 2, hc: 2.5, grasa: 0.6 });
  });

  it("el mismo reparto da g/kg distintos según la persona", () => {
    // Es exactamente para esto que existe: un 30% de proteína no dice nada
    // hasta que se sabe cuánto pesa quien se lo come.
    expect(porKilo(M, 50)!.prot).toBeCloseTo(4, 6);
    expect(porKilo(M, 100)!.prot).toBeCloseTo(2, 6);
  });

  it("sin peso devuelve null, no un cero que parezca un dato", () => {
    expect(porKilo(M, null)).toBeNull();
    expect(porKilo(M, undefined)).toBeNull();
  });

  it("un peso imposible tampoco da un número", () => {
    expect(porKilo(M, 0)).toBeNull();
    expect(porKilo(M, -70)).toBeNull();
    expect(porKilo(M, Number.NaN)).toBeNull();
    expect(porKilo(M, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
