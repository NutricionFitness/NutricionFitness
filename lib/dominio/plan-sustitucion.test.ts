import { describe, expect, it } from "vitest";

import {
  planDeSustitucion,
  repartoPct,
  type ComponenteCambiable,
} from "./plan-sustitucion";
import { distanciaAlObjetivo, type Candidato, type Macros } from "./sustituir";

const ing = (
  id: number,
  nombre: string,
  prot: number,
  hc: number,
  grasa: number,
  grupo = "Cereales y derivados",
): Candidato => ({
  id,
  nombre,
  grupo,
  estado: "crudo",
  prot,
  hc,
  grasa,
  kcal100: 4 * prot + 4 * hc + 9 * grasa,
});

const ARROZ = ing(1, "Arroz blanco", 7, 78, 0.6);
const PAN = ing(2, "Pan blanco", 8, 52, 1.5);
const ACEITE = ing(3, "Aceite de oliva", 0, 0, 100, "Grasas y aceites");
const MERLUZA = ing(4, "Merluza", 17, 0, 1.8, "Pescados y mariscos");

const CATALOGO = [
  ing(10, "Lentejas", 24, 54, 1.8, "Legumbres"),
  ing(11, "Garbanzos", 20, 55, 5, "Legumbres"),
  ing(12, "Pan integral", 11, 45, 2.5),
  ing(13, "Pasta", 12, 74, 1.5),
  ing(14, "Quinoa", 14, 64, 6),
  ing(15, "Pechuga de pollo", 22, 0, 2.5, "Carnes y derivados"),
  ing(16, "Atún al natural", 26, 0, 1, "Pescados y mariscos"),
  ing(17, "Nata", 2, 3, 35, "Lácteos"),
];

const comp = (
  id: string,
  comida: string,
  ingrediente: Candidato,
  gramos: number,
  movible = true,
): ComponenteCambiable => ({ componenteId: id, comida, gramos, ingrediente, movible });

/** Una dieta de 2.000 kcal repartida 25/50/25. */
const MACROS: Macros = { prot: 125, hc: 250, grasa: 55.6 };
const ENERGIA = 4 * MACROS.prot + 4 * MACROS.hc + 9 * MACROS.grasa;

const DIETA = [
  comp("c1", "Comida", ARROZ, 100),
  comp("c2", "Desayuno", PAN, 80),
  comp("c3", "Comida", ACEITE, 20),
  comp("c4", "Cena", MERLUZA, 150),
];

/** Subir proteína: está a veinte puntos del reparto actual. */
const MAS_PROTEINA = { prot: 0.35, hc: 0.4, grasa: 0.25 };

describe("el reparto en porcentaje", () => {
  it("sale el que es", () => {
    const p = repartoPct(MACROS, ENERGIA);
    expect(p.prot).toBeCloseTo(25, 1);
    expect(p.hc).toBeCloseTo(50, 1);
    expect(p.grasa).toBeCloseTo(25, 1);
  });

  it("sin energía no inventa nada", () => {
    expect(repartoPct(MACROS, 0)).toEqual({ prot: 0, hc: 0, grasa: 0 });
  });
});

describe("el plan", () => {
  it("encadena varios cambios y cada uno acerca más", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);

    expect(p.pasos.length).toBeGreaterThan(1);
    expect(p.distanciaFinal).toBeLessThan(p.distanciaInicial);
    for (const paso of p.pasos) expect(paso.mejora).toBeGreaterThan(0);
  });

  it("la cadena entera acerca más que su primer paso", () => {
    // Ésta es la razón de ser de encadenar: si no, con uno bastaba.
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    expect(p.pasos.length).toBeGreaterThan(1);
    const soloElPrimero = p.distanciaInicial - p.pasos[0].mejora;
    expect(p.distanciaFinal).toBeLessThan(soloElPrimero);
  });

  it("las mejoras suman exactamente lo que se ha recorrido", () => {
    // Si esto no cuadra, es que un paso se ha calculado sobre unos macros que
    // no son los que deja el paso anterior, y la cadena sería mentira.
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    const suma = p.pasos.reduce((s, x) => s + x.mejora, 0);
    expect(p.distanciaInicial - p.distanciaFinal).toBeCloseTo(suma, 1);
  });

  it("el reparto que anuncia el último paso es el reparto final", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    const ultimo = p.pasos[p.pasos.length - 1];
    expect(ultimo.pct.prot).toBeCloseTo(p.pctFinal.prot, 6);
    expect(ultimo.pct.hc).toBeCloseTo(p.pctFinal.hc, 6);
    expect(ultimo.pct.grasa).toBeCloseTo(p.pctFinal.grasa, 6);
  });

  it("y el reparto final cuadra con la distancia final", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    const macrosFinales: Macros = {
      prot: (p.pctFinal.prot * ENERGIA) / 400,
      hc: (p.pctFinal.hc * ENERGIA) / 400,
      grasa: (p.pctFinal.grasa * ENERGIA) / 900,
    };
    expect(distanciaAlObjetivo(macrosFinales, ENERGIA, MAS_PROTEINA)).toBeCloseTo(
      p.distanciaFinal,
      1,
    );
  });

  it("no toca dos veces el mismo componente", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    const ids = p.pasos.map((x) => x.componenteId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no pasa del tope de pasos", () => {
    expect(
      planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA, { maxPasos: 2 })
        .pasos.length,
    ).toBeLessThanOrEqual(2);
    expect(
      planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA, { maxPasos: 1 })
        .pasos.length,
    ).toBe(1);
  });
});

describe("lo que el plan no toca", () => {
  it("respeta «no tocar»: un componente inmóvil no se propone", () => {
    // El motor no le mueve los gramos; cambiarle el alimento entero sería peor.
    const soloArrozInmovil = [
      comp("c1", "Comida", ARROZ, 100, false),
      comp("c2", "Desayuno", PAN, 80),
    ];
    const p = planDeSustitucion(soloArrozInmovil, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    expect(p.pasos.map((x) => x.componenteId)).not.toContain("c1");
  });

  it("respeta lo que el usuario ha descartado", () => {
    const sinNada = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    const primero = sinNada.pasos[0].componenteId;

    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA, {
      excluir: new Set([primero]),
    });
    expect(p.pasos.map((x) => x.componenteId)).not.toContain(primero);
    // Y sigue proponiendo algo con los demás.
    expect(p.pasos.length).toBeGreaterThan(0);
  });

  it("solo propone lo que se le da: los alérgenos se quitan antes de llegar", () => {
    // El filtro de alergias vive en el servidor, que es quien conoce la base.
    // Aquí lo único que hay que garantizar es que no se saca nada de la manga.
    const sinLegumbres = CATALOGO.filter((c) => c.grupo !== "Legumbres");
    const p = planDeSustitucion(DIETA, sinLegumbres, MACROS, ENERGIA, MAS_PROTEINA);
    for (const paso of p.pasos) expect(paso.candidato.grupo).not.toBe("Legumbres");
  });

  it("no propone el mismo alimento en dos pasos", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    const ids = p.pasos.map((x) => x.candidato.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no propone un alimento que ya está en esa misma comida", () => {
    // Dos lentejas en la misma comida no es un plan, es un despiste. En otra
    // comida sí vale: repetir alimento a lo largo del día es de lo más normal.
    const LENTEJAS = CATALOGO[0];
    const conLentejas = [
      comp("c1", "Comida", ARROZ, 100),
      comp("c2", "Comida", LENTEJAS, 90),
      comp("c3", "Cena", MERLUZA, 150),
    ];
    const p = planDeSustitucion(conLentejas, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    const enComida = p.pasos.filter((x) => x.comida === "Comida");
    for (const paso of enComida) expect(paso.candidato.id).not.toBe(LENTEJAS.id);
  });

  it("descartar un alimento lo quita de toda la cadena", () => {
    const sinNada = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    const noQuiero = sinNada.pasos[0].candidato.id;

    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA, {
      sinEstos: new Set([noQuiero]),
    });
    expect(p.pasos.map((x) => x.candidato.id)).not.toContain(noQuiero);
    // Y sigue proponiendo algo con lo que queda.
    expect(p.pasos.length).toBeGreaterThan(0);
  });

  it("descartar alimentos no rompe el que la cadena siga cuadrando", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA, {
      sinEstos: new Set([CATALOGO[0].id, CATALOGO[5].id]),
    });
    const suma = p.pasos.reduce((s, x) => s + x.mejora, 0);
    expect(p.distanciaInicial - p.distanciaFinal).toBeCloseTo(suma, 1);
  });

  it("si se descarta todo el catálogo, no hay plan y se dice", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA, {
      sinEstos: new Set(CATALOGO.map((c) => c.id)),
    });
    expect(p.pasos).toEqual([]);
    expect(p.motivo).toBe("nada_que_hacer");
  });
});

describe("cuándo no hay nada que decir", () => {
  it("con el reparto que la dieta ya tiene, ningún paso", () => {
    const actual = repartoPct(MACROS, ENERGIA);
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, {
      prot: actual.prot / 100,
      hc: actual.hc / 100,
      grasa: actual.grasa / 100,
    });
    expect(p.pasos).toEqual([]);
    expect(p.motivo).toBe("nada_que_hacer");
  });

  it("sin objetivo, ningún paso", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, {});
    expect(p.pasos).toEqual([]);
    expect(p.motivo).toBe("nada_que_hacer");
  });

  it("sin energía, ningún paso y no revienta", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, 0, MAS_PROTEINA);
    expect(p.pasos).toEqual([]);
    expect(p.motivo).toBe("nada_que_hacer");
  });

  it("sin catálogo, ningún paso", () => {
    const p = planDeSustitucion(DIETA, [], MACROS, ENERGIA, MAS_PROTEINA);
    expect(p.pasos).toEqual([]);
  });

  it("con todos los componentes inmóviles, ningún paso", () => {
    const quietos = DIETA.map((c) => ({ ...c, movible: false }));
    const p = planDeSustitucion(quietos, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    expect(p.pasos).toEqual([]);
  });

  it("dice por qué se ha parado", () => {
    const conTope = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA, {
      maxPasos: 1,
    });
    expect(conTope.motivo).toBe("tope");

    // Con un solo componente movible no puede haber más de un paso, así que se
    // para por falta de candidatos y no por el tope.
    const unoSolo = [comp("c1", "Comida", ARROZ, 100)];
    const p = planDeSustitucion(unoSolo, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA, {
      maxPasos: 3,
    });
    expect(p.pasos).toHaveLength(1);
    expect(p.motivo).toBe("sin_mas");
  });
});

describe("las sustituciones que propone son isoenergéticas", () => {
  it("ningún paso mueve la energía de la dieta", () => {
    // Es la propiedad que sostiene todo lo demás: si la energía cambiara, no se
    // podrían comparar repartos antes y después.
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    for (const paso of p.pasos) {
      const dE = 4 * paso.delta.prot + 4 * paso.delta.hc + 9 * paso.delta.grasa;
      expect(dE).toBeCloseTo(0, 6);
    }
  });

  it("y por eso los tres porcentajes del final siguen sumando 100", () => {
    const p = planDeSustitucion(DIETA, CATALOGO, MACROS, ENERGIA, MAS_PROTEINA);
    const s = p.pctFinal.prot + p.pctFinal.hc + p.pctFinal.grasa;
    expect(s).toBeCloseTo(100, 6);
  });
});
