import { describe, expect, it } from "vitest";

import { compararDietas } from "./comparar";
import type { DietaCompleta, FilaIngrediente } from "./tipos";

const ING: Record<string, FilaIngrediente> = {
  arroz: { id: 1, nombre: "Arroz", kcal_100: 345.4, prot_100: 7, hc_100: 78, grasa_100: 0.6, fibra_100: 1.3 } as FilaIngrediente,
  pollo: { id: 2, nombre: "Pollo", kcal_100: 110.5, prot_100: 22, hc_100: 0, grasa_100: 2.5, fibra_100: 0 } as FilaIngrediente,
  aceite: { id: 3, nombre: "Aceite", kcal_100: 900, prot_100: 0, hc_100: 0, grasa_100: 100, fibra_100: 0 } as FilaIngrediente,
  tomate: { id: 4, nombre: "Tomate", kcal_100: 19.8, prot_100: 1, hc_100: 3.5, grasa_100: 0.2, fibra_100: 1.4 } as FilaIngrediente,
};

/** Construye una dieta: [[comida, orden, [[ingrediente, gramos], ...]], ...] */
function dieta(
  id: string,
  comidas: Array<[string, number, Array<[keyof typeof ING, number]>]>,
): DietaCompleta {
  return {
    id,
    nombre: id,
    version: 1,
    comidas: comidas.map(([nombre, orden, comps], im) => ({
      id: `${id}-m${im}`,
      dieta_id: id,
      nombre,
      orden,
      componentes: comps.map(([clave, gramos], ic) => ({
        id: `${id}-c${im}-${ic}`,
        comida_id: `${id}-m${im}`,
        ingrediente_id: ING[clave].id,
        // como llegan de PostgreSQL: cadenas
        gramos: String(gramos) as unknown as number,
        orden: ic,
        bloqueado: false,
        prioridad: 1,
        min_g: null,
        max_g: null,
        paso_g: 5,
        ingredientes: ING[clave],
      })),
    })),
  } as unknown as DietaCompleta;
}

const BASE = () =>
  dieta("A", [
    ["Comida", 0, [["arroz", 80], ["pollo", 150], ["aceite", 10]]],
    ["Cena", 1, [["tomate", 100]]],
  ]);

describe("comparación de versiones", () => {
  it("detecta que no ha cambiado nada", () => {
    const c = compararDietas(BASE(), dieta("B", [
      ["Comida", 0, [["arroz", 80], ["pollo", 150], ["aceite", 10]]],
      ["Cena", 1, [["tomate", 100]]],
    ]));
    expect(c.hayCambios).toBe(false);
    expect(c.lineas.every((l) => l.estado === "igual")).toBe(true);
    expect(c.totalA.kcal).toBeCloseTo(c.totalB.kcal, 9);
  });

  it("casa los componentes aunque los identificadores sean distintos", () => {
    // Es lo que pasa siempre: guardar un ajuste clona la dieta.
    const c = compararDietas(BASE(), dieta("B", [
      ["Comida", 0, [["arroz", 65], ["pollo", 145], ["aceite", 10]]],
      ["Cena", 1, [["tomate", 100]]],
    ]));
    const arroz = c.lineas.find((l) => l.ingrediente === "Arroz")!;
    expect(arroz.estado).toBe("cambia");
    expect(arroz.gramosA).toBe(80);
    expect(arroz.gramosB).toBe(65);
    expect(arroz.deltaG).toBe(-15);
    expect(arroz.deltaKcal).toBeCloseTo((65 - 80) * 3.454, 6);
    expect(c.nAnadidos).toBe(0);
    expect(c.nQuitados).toBe(0);
  });

  it("marca lo que se ha añadido y lo que se ha quitado", () => {
    const c = compararDietas(BASE(), dieta("B", [
      ["Comida", 0, [["arroz", 80], ["aceite", 10], ["tomate", 50]]],
      ["Cena", 1, [["tomate", 100]]],
    ]));
    const pollo = c.lineas.find((l) => l.ingrediente === "Pollo")!;
    expect(pollo.estado).toBe("quitado");
    expect(pollo.gramosB).toBeNull();
    expect(pollo.deltaKcal).toBeLessThan(0);

    const nuevo = c.lineas.find((l) => l.comida === "Comida" && l.ingrediente === "Tomate")!;
    expect(nuevo.estado).toBe("anadido");
    expect(nuevo.gramosA).toBeNull();
    expect(nuevo.gramosB).toBe(50);

    expect(c.nAnadidos).toBe(1);
    expect(c.nQuitados).toBe(1);
    expect(c.hayCambios).toBe(true);
  });

  it("el mismo ingrediente dos veces en una comida se empareja en orden", () => {
    const a = dieta("A", [["Comida", 0, [["arroz", 80], ["arroz", 20]]]]);
    const b = dieta("B", [["Comida", 0, [["arroz", 70], ["arroz", 30]]]]);
    const c = compararDietas(a, b);
    expect(c.lineas).toHaveLength(2);
    expect(c.lineas.map((l) => [l.gramosA, l.gramosB])).toEqual([
      [80, 70],
      [20, 30],
    ]);
    expect(c.nAnadidos + c.nQuitados).toBe(0);
  });

  it("una comida que solo existe en una de las dos versiones también aparece", () => {
    const c = compararDietas(
      dieta("A", [["Comida", 0, [["arroz", 80]]]]),
      dieta("B", [["Comida", 0, [["arroz", 80]]], ["Merienda", 2, [["tomate", 60]]]]),
    );
    expect(c.grupos.map((g) => g.comida)).toEqual(["Comida", "Merienda"]);
    expect(c.grupos[1].lineas[0].estado).toBe("anadido");
  });

  it("los totales se calculan sobre cadenas de PostgreSQL sin concatenar", () => {
    const c = compararDietas(BASE(), BASE());
    const esperado =
      (80 * 345.4 + 150 * 110.5 + 10 * 900 + 100 * 19.8) / 100;
    expect(c.totalA.kcal).toBeCloseTo(esperado, 6);
    expect(c.totalA.kcal).toBeGreaterThan(500);
  });

  it("los porcentajes de macros suman cien", () => {
    const c = compararDietas(BASE(), BASE());
    const { prot, hc, grasa } = c.totalA.pct;
    expect(prot + hc + grasa).toBeCloseTo(100, 6);
  });

  it("los totales por comida suman el total del día", () => {
    const c = compararDietas(BASE(), BASE());
    const suma = c.grupos.reduce((s, g) => s + g.kcalA, 0);
    expect(suma).toBeCloseTo(c.totalA.kcal, 6);
  });

  it("una dieta vacía no revienta la comparación", () => {
    const vacia = dieta("V", [["Comida", 0, []]]);
    const c = compararDietas(vacia, dieta("B", [["Comida", 0, [["arroz", 80]]]]));
    expect(c.totalA.kcal).toBe(0);
    expect(c.totalA.pct).toEqual({ prot: 0, hc: 0, grasa: 0 });
    expect(c.nAnadidos).toBe(1);
  });

  it("comparar en el otro sentido invierte los signos", () => {
    const a = BASE();
    const b = dieta("B", [
      ["Comida", 0, [["arroz", 65], ["pollo", 150], ["aceite", 10]]],
      ["Cena", 1, [["tomate", 100]]],
    ]);
    const ida = compararDietas(a, b);
    const vuelta = compararDietas(b, a);
    const arrozIda = ida.lineas.find((l) => l.ingrediente === "Arroz")!;
    const arrozVuelta = vuelta.lineas.find((l) => l.ingrediente === "Arroz")!;
    expect(arrozVuelta.deltaG).toBeCloseTo(-arrozIda.deltaG, 9);
    expect(arrozVuelta.deltaKcal).toBeCloseTo(-arrozIda.deltaKcal, 9);
  });
});
