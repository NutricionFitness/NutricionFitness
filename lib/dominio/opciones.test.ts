import { describe, expect, it } from "vitest";

import { compararOpcion, objetivoParaCuadrar, TOLERANCIA } from "./opciones";
import { totalesDe } from "./totales";
import type { Componente, Ingrediente } from "@/lib/motor";

const ing = (nombre: string, prot: number, hc: number, grasa: number): Ingrediente => ({
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
});

const c = (i: Ingrediente, gramos: number): Componente => ({
  ingrediente: i,
  gramos,
  comida: "Desayuno",
});

const PAN = ing("Pan", 8, 52, 1.5);          // 253,5 kcal/100 g
const LECHE = ing("Leche", 3.1, 4.7, 3.6);   // 63,6 kcal/100 g
const AVENA = ing("Avena", 11, 59, 7);       // 343 kcal/100 g
const ACEITE = ing("Aceite", 0, 0, 100);     // 900 kcal/100 g

/** El desayuno de referencia: pan y leche. */
const REFERENCIA = [c(PAN, 60), c(LECHE, 200)];

describe("cuándo una opción es equivalente", () => {
  it("ella misma lo es, obviamente", () => {
    const e = compararOpcion(REFERENCIA, REFERENCIA);
    expect(e.equivalente).toBe(true);
    expect(e.motivos).toEqual([]);
    expect(e.difKcal).toBeCloseTo(0, 6);
  });

  it("una copia con otros alimentos que cuadran, también", () => {
    // Se busca la avena que iguala kcal y reparto de pan+leche.
    const r = totalesDe(REFERENCIA);
    const gAvena = (r.energia * 0.72) / 3.43;   // ~72% de la energía
    const gLeche = (r.energia * 0.28) / 0.636;
    const e = compararOpcion(REFERENCIA, [c(AVENA, gAvena), c(LECHE, gLeche)]);
    expect(e.difKcalPct).toBeCloseTo(0, 6);
    // Puede cuadrar o no en macros; lo que se fija aquí es que la energía sí.
    expect(Math.abs(e.difKcalPct)).toBeLessThan(TOLERANCIA.kcalRel * 100);
  });

  it("una opción vacía no es equivalente, y lo dice sin números raros", () => {
    const e = compararOpcion(REFERENCIA, []);
    expect(e.equivalente).toBe(false);
    expect(e.motivos).toEqual(["Esta opción no tiene ningún alimento todavía."]);
  });
});

describe("cuando no cuadra, dice en qué", () => {
  it("por energía, con la cifra y el margen", () => {
    // Un 20% más de todo: mismo reparto, otra energía.
    const e = compararOpcion(REFERENCIA, REFERENCIA.map((x) => ({ ...x, gramos: x.gramos * 1.2 })));
    expect(e.equivalente).toBe(false);
    expect(e.motivos).toHaveLength(1);
    expect(e.motivos[0]).toContain("Sobran");
    expect(e.motivos[0]).toContain("kcal");
    expect(e.motivos[0]).toContain("20%");
  });

  it("y por macros, nombrando el macro", () => {
    // Misma energía, todo de aceite: 100% grasa.
    const r = totalesDe(REFERENCIA);
    const e = compararOpcion(REFERENCIA, [c(ACEITE, (r.energia * 100) / 900)]);
    expect(e.equivalente).toBe(false);
    expect(Math.abs(e.difKcalPct)).toBeLessThan(0.001);
    expect(e.motivos.join(" ")).toContain("grasa");
    expect(e.motivos.join(" ")).toContain("hidratos");
    // La energía cuadra, así que de eso no se queja.
    expect(e.motivos.some((m) => m.includes("kcal"))).toBe(false);
  });

  it("un 4% de más pasa, un 6% no: el margen es del 5%", () => {
    const cuatro = compararOpcion(REFERENCIA, REFERENCIA.map((x) => ({ ...x, gramos: x.gramos * 1.04 })));
    const seis = compararOpcion(REFERENCIA, REFERENCIA.map((x) => ({ ...x, gramos: x.gramos * 1.06 })));
    expect(cuatro.equivalente).toBe(true);
    expect(seis.equivalente).toBe(false);
  });

  it("los desvíos vienen de mayor a menor", () => {
    const r = totalesDe(REFERENCIA);
    const e = compararOpcion(REFERENCIA, [c(ACEITE, (r.energia * 100) / 900)]);
    const abs = e.desvios.map((d) => Math.abs(d.puntos));
    expect(abs).toEqual([...abs].sort((a, b) => b - a));
  });

  it("la tolerancia se puede apretar", () => {
    const casi = REFERENCIA.map((x) => ({ ...x, gramos: x.gramos * 1.03 }));
    expect(compararOpcion(REFERENCIA, casi).equivalente).toBe(true);
    expect(
      compararOpcion(REFERENCIA, casi, "atwater", { kcalRel: 0.01, macroPuntos: 3 }).equivalente,
    ).toBe(false);
  });

  it("una referencia sin energía se dice, no se divide por cero", () => {
    const e = compararOpcion([], [c(PAN, 60)]);
    expect(e.equivalente).toBe(false);
    expect(e.motivos[0]).toContain("referencia");
    expect(Number.isFinite(e.difKcalPct)).toBe(true);
  });
});

describe("qué se le pide al motor para cuadrar una opción", () => {
  it("las kcal de la referencia y su reparto, en tanto por uno", () => {
    const r = totalesDe(REFERENCIA);
    const o = objetivoParaCuadrar(r);
    expect(o.kcal).toBeCloseTo(r.energia, 6);
    expect(o.macrosObjetivo.prot).toBeCloseTo(r.pct.prot / 100, 9);
    expect(o.macrosObjetivo.hc).toBeCloseTo(r.pct.hc / 100, 9);
    expect(o.macrosObjetivo.grasa).toBeCloseTo(r.pct.grasa / 100, 9);
  });

  it("y suma 1, que es lo que el motor espera", () => {
    const o = objetivoParaCuadrar(totalesDe(REFERENCIA));
    const suma = o.macrosObjetivo.prot + o.macrosObjetivo.hc + o.macrosObjetivo.grasa;
    expect(suma).toBeCloseTo(1, 6);
  });
});

describe("la propiedad que hace que todo esto valga", () => {
  it("si todas las opciones cuadran con la referencia, la dieta vale lo mismo elijas la que elijas", () => {
    // Es el motivo entero de la regla: sin ella, el total de la dieta
    // dependería de qué combinación esté activa.
    const r = totalesDe(REFERENCIA);
    const otra = REFERENCIA.map((x) => ({ ...x, gramos: x.gramos * 1.02 }));
    const tercera = REFERENCIA.map((x) => ({ ...x, gramos: x.gramos * 0.98 }));

    for (const o of [otra, tercera]) expect(compararOpcion(REFERENCIA, o).equivalente).toBe(true);

    // Y las energías de las tres se parecen dentro del margen anunciado.
    for (const o of [otra, tercera]) {
      const t = totalesDe(o);
      expect(Math.abs(t.energia - r.energia) / r.energia).toBeLessThanOrEqual(
        TOLERANCIA.kcalRel,
      );
    }
  });
});
