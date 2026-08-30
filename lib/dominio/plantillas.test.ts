import { describe, expect, it } from "vitest";

import {
  avisoEstadoCantidades,
  destinoDeImportacion,
  encajarPlantilla,
  nombreLibre,
} from "./plantillas";
import { compararOpcion } from "./opciones";
import { totalesDe } from "./totales";
import type { Componente, Ingrediente } from "@/lib/motor";
import type { FilaOpcion } from "./tipos";

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

const PAN = ing("Pan", 8, 52, 1.5); // 253,5 kcal/100 g
const LECHE = ing("Leche", 3.1, 4.7, 3.6); // 63,6 kcal/100 g
const AVENA = ing("Avena", 11, 59, 7); // 343 kcal/100 g
const CLARA = ing("Clara", 11, 0.7, 0.2); // 48,6 kcal/100 g

/** El desayuno de referencia: pan y leche. 279 kcal, reparto 16/58/26. */
const REFERENCIA = [c(PAN, 60), c(LECHE, 200)];

const op = (id: string, orden: number, nombre = id): FilaOpcion => ({
  id,
  comida_id: "m1",
  nombre,
  orden,
});

// ---------------------------------------------------------------------------
describe("dónde entra la plantilla", () => {
  it("en la única opción de la comida, si está vacía", () => {
    // Es la comida recién creada: el disparador de la 0012 le pone su «Opción 1».
    const d = destinoDeImportacion([op("o1", 0)], { o1: [] });
    expect(d).toEqual({ modo: "rellenar", opcionId: "o1" });
  });

  it("en una opción nueva si la única que hay ya tiene alimentos", () => {
    const d = destinoDeImportacion([op("o1", 0)], { o1: REFERENCIA });
    expect(d).toEqual({ modo: "nueva", opcionId: null });
  });

  it("en una opción nueva si hay más de una, aunque alguna esté vacía", () => {
    // Rellenar la vacía sería sustituir lo que alguien estaba montando.
    const d = destinoDeImportacion([op("o1", 0), op("o2", 1)], { o1: REFERENCIA, o2: [] });
    expect(d).toEqual({ modo: "nueva", opcionId: null });
  });

  it("y no se fía del orden en que lleguen las opciones", () => {
    const d = destinoDeImportacion([op("o2", 1), op("o1", 0)], { o1: [], o2: [] });
    expect(d.modo).toBe("nueva");
  });
});

// ---------------------------------------------------------------------------
describe("el nombre con el que entra", () => {
  it("el suyo, si no lo tiene nadie", () => {
    expect(nombreLibre("Con tortilla", ["Opción 1"])).toBe("Con tortilla");
  });

  it("con sufijo si choca, porque el único (comida, nombre) reventaría", () => {
    expect(nombreLibre("Con tortilla", ["Con tortilla"])).toBe("Con tortilla (2)");
  });

  it("y sigue subiendo mientras siga chocando", () => {
    expect(nombreLibre("Con tortilla", ["Con tortilla", "Con tortilla (2)"])).toBe(
      "Con tortilla (3)",
    );
  });

  it("los espacios de más no cuentan como nombre distinto", () => {
    expect(nombreLibre("  Con tortilla  ", ["Con tortilla"])).toBe("Con tortilla (2)");
  });

  it("un nombre en blanco no puede entrar: la base exige que tenga algo", () => {
    expect(nombreLibre("   ", [])).toBe("Opción");
  });
});

// ---------------------------------------------------------------------------
describe("con qué gramos entra", () => {
  it("tal cual cuando rellena una opción vacía: no hay con qué comparar", () => {
    const plantilla = [c(AVENA, 50), c(LECHE, 150)];
    const e = encajarPlantilla(plantilla, null);
    expect(e.componentes).toBe(plantilla);
    expect(e.cuadrada).toBe(true);
    expect(e.ajustada).toBe(false);
    expect(e.motivos).toEqual([]);
  });

  it("cuadrada contra la referencia cuando la comida ya tiene una", () => {
    // Una plantilla que viene de una dieta más pequeña: 179 kcal contra 279.
    // Entra como 60 g de avena + 115 g de leche, 279 kcal y 15/58/27.
    const plantilla = [c(AVENA, 30), c(LECHE, 120)];
    const e = encajarPlantilla(plantilla, REFERENCIA);

    expect(e.ajustada).toBe(true);
    expect(e.cuadrada).toBe(true);
    expect(e.motivos).toEqual([]);

    // Y lo que importa: cuadrada DE VERDAD, comprobado con la regla, no con lo
    // que diga el motor.
    const eq = compararOpcion(REFERENCIA, e.componentes);
    expect(eq.equivalente).toBe(true);
    expect(totalesDe(e.componentes).energia).toBeCloseTo(totalesDe(REFERENCIA).energia, 0);
  });

  it("no toca lo que no hace falta tocar: una plantilla que ya cuadra sale igual", () => {
    const e = encajarPlantilla(REFERENCIA.map((x) => ({ ...x })), REFERENCIA);
    expect(e.cuadrada).toBe(true);
    expect(totalesDe(e.componentes).energia).toBeCloseTo(totalesDe(REFERENCIA).energia, 0);
  });

  it("entra descuadrada y lo dice cuando moviendo gramos no se llega", () => {
    // Solo clara de huevo: se puede llegar a las kcal, pero el reparto se va
    // a proteína y no hay forma de traerlo con estos alimentos.
    const e = encajarPlantilla([c(CLARA, 100)], REFERENCIA);
    expect(e.cuadrada).toBe(false);
    expect(e.motivos.length).toBeGreaterThan(0);
    expect(e.motivos.join(" ")).toMatch(/puntos de/);
    // Entra igual: la pantalla cae en el aviso de la fase 20, con su botón.
    expect(e.componentes.length).toBe(1);
  });

  it("una plantilla vacía no entra, y se dice por qué", () => {
    const e = encajarPlantilla([], REFERENCIA);
    expect(e.componentes).toEqual([]);
    expect(e.cuadrada).toBe(false);
    expect(e.sinIntentar).toBe("la plantilla está vacía");
  });

  it("NO se cuadra contra una referencia sin energía: la vaciaría en silencio", () => {
    // Pedirle al motor 0 kcal manda todos los gramos a su mínimo. Entrar
    // descuadrada y decirlo es mucho mejor que entrar a cero sin decir nada.
    const plantilla = [c(AVENA, 50), c(LECHE, 150)];
    const e = encajarPlantilla(plantilla, [c(ing("Agua", 0, 0, 0), 200)]);

    expect(e.ajustada).toBe(false);
    expect(e.componentes).toBe(plantilla);
    expect(totalesDe(e.componentes).energia).toBeGreaterThan(0);
    expect(e.sinIntentar).toBe("la opción de referencia no aporta energía");
  });
});

// ---------------------------------------------------------------------------
describe("crudo contra cocido", () => {
  it("callado cuando coinciden", () => {
    expect(avisoEstadoCantidades("crudo", "crudo")).toBeNull();
    expect(avisoEstadoCantidades("mixto", "mixto")).toBeNull();
  });

  it("dice los dos estados y que no se convierte", () => {
    const a = avisoEstadoCantidades("crudo", "cocido");
    expect(a).toContain("en crudo");
    expect(a).toContain("en cocido");
    expect(a).toContain("sin convertir");
  });

  it("también avisa contra una dieta mixta, que es donde más se lía", () => {
    expect(avisoEstadoCantidades("cocido", "mixto")).toContain("unos alimentos en crudo");
  });
});
