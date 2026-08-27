import { describe, expect, it } from "vitest";

import {
  distanciaAlObjetivo,
  gramosIsoenergeticos,
  mereceDirigido,
  rankearHaciaObjetivo,
  rankearSustitutos,
  type Candidato,
  type Macros,
} from "./sustituir";

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

const ARROZ = ing(1, "Arroz", 7, 78, 0.6);
const QUINOA = ing(2, "Quinoa", 14, 64, 6);
const PASTA = ing(3, "Pasta", 12, 72, 1.5);
const POLLO = ing(4, "Pollo", 22, 0, 2.5, "Carnes y derivados");
const LECHUGA = ing(5, "Lechuga", 1.4, 1.4, 0.2, "Verduras y hortalizas");
const AGUA = ing(6, "Agua", 0, 0, 0, "Bebidas");

describe("gramos isoenergéticos", () => {
  it("iguala la energía", () => {
    // 100 g de arroz (345,4 kcal) frente a pasta (349,5 kcal/100 g)
    const g = gramosIsoenergeticos(ARROZ.kcal100, 100, PASTA.kcal100)!;
    expect((g * PASTA.kcal100) / 100).toBeCloseTo(ARROZ.kcal100, 6);
  });

  it("un alimento sin energía no sustituye a nada", () => {
    expect(gramosIsoenergeticos(ARROZ.kcal100, 100, 0)).toBeNull();
    expect(gramosIsoenergeticos(ARROZ.kcal100, 100, AGUA.kcal100)).toBeNull();
  });
});

describe("sustitutos parecidos", () => {
  it("ordena de más a menos parecido", () => {
    const r = rankearSustitutos(ARROZ, 80, [QUINOA, PASTA, POLLO]);
    expect(r[0].candidato.nombre).toBe("Pasta"); // otro cereal, casi el mismo perfil
    expect(r.at(-1)!.candidato.nombre).toBe("Pollo"); // sin hidratos, altera mucho
  });

  it("todas las propuestas conservan la energía", () => {
    const r = rankearSustitutos(ARROZ, 80, [QUINOA, PASTA, POLLO]);
    const kcalOriginal = (80 * ARROZ.kcal100) / 100;
    for (const s of r)
      expect((s.gramos * s.candidato.kcal100) / 100).toBeCloseTo(kcalOriginal, 0);
  });

  it("no se propone a sí mismo", () => {
    const r = rankearSustitutos(ARROZ, 80, [ARROZ, PASTA]);
    expect(r.map((s) => s.candidato.id)).not.toContain(ARROZ.id);
  });

  it("descarta lo que exigiría cantidades absurdas", () => {
    // igualar 80 g de arroz con lechuga son casi 1,4 kg: isoenergético e inútil
    const r = rankearSustitutos(ARROZ, 80, [LECHUGA, PASTA]);
    expect(r.map((s) => s.candidato.nombre)).toEqual(["Pasta"]);
  });

  it("la banda de cantidades es configurable", () => {
    const r = rankearSustitutos(ARROZ, 80, [LECHUGA], {
      maxRelativo: 100,
      maxGramosAbsoluto: 5000,
    });
    expect(r).toHaveLength(1);
    expect(r[0].gramos).toBeGreaterThan(500);
  });

  it("hay además un tope absoluto de gramos", () => {
    // aunque la banda relativa lo permita, 1,4 kg de lechuga no es un plato
    expect(rankearSustitutos(ARROZ, 80, [LECHUGA], { maxRelativo: 100 })).toEqual([]);
  });

  it("al cruzar de grupo no se proponen cosas que nadie come a cucharadas", () => {
    const CAFE = ing(8, "Café soluble", 14, 41, 0.5, "Bebidas");
    // dentro de su grupo sí vale como respuesta
    const CAFE2 = ing(9, "Café soluble descafeinado", 13, 42, 0.5, "Bebidas");
    expect(rankearSustitutos(ARROZ, 80, [CAFE, PASTA]).map((s) => s.candidato.nombre))
      .toEqual(["Pasta"]);
    expect(rankearSustitutos(CAFE, 10, [CAFE2]).map((s) => s.candidato.nombre))
      .toEqual(["Café soluble descafeinado"]);
  });

  it("el delta de macros dice la verdad", () => {
    const r = rankearSustitutos(ARROZ, 100, [POLLO], { maxRelativo: 100 });
    const s = r[0];
    // el pollo aporta mucha más proteína y ningún hidrato
    expect(s.delta.prot).toBeGreaterThan(0);
    expect(s.delta.hc).toBeCloseTo(-78, 0);
  });

  it("sin candidatos o con datos imposibles devuelve lista vacía", () => {
    expect(rankearSustitutos(ARROZ, 80, [])).toEqual([]);
    expect(rankearSustitutos(ARROZ, 0, [PASTA])).toEqual([]);
    expect(rankearSustitutos(AGUA, 80, [PASTA])).toEqual([]);
  });

  it("respeta el límite", () => {
    expect(rankearSustitutos(ARROZ, 80, [QUINOA, PASTA, POLLO], { limite: 2 })).toHaveLength(2);
  });
});

describe("distancia al objetivo", () => {
  const macros = { prot: 100, hc: 200, grasa: 60 };
  const energia = 4 * 100 + 4 * 200 + 9 * 60; // 1740

  it("es cero cuando se cumple el reparto", () => {
    const pct = {
      prot: (400 / energia) * 100,
      hc: (800 / energia) * 100,
      grasa: (540 / energia) * 100,
    };
    expect(distanciaAlObjetivo(macros, energia, pct)).toBeCloseTo(0, 6);
  });

  it("crece al alejarse", () => {
    const cerca = distanciaAlObjetivo(macros, energia, { prot: 0.25 });
    const lejos = distanciaAlObjetivo(macros, energia, { prot: 0.5 });
    expect(lejos).toBeGreaterThan(cerca);
  });

  it("admite el objetivo en fracción o en porcentaje", () => {
    expect(distanciaAlObjetivo(macros, energia, { prot: 0.3 })).toBeCloseTo(
      distanciaAlObjetivo(macros, energia, { prot: 30 }),
      6,
    );
  });

  it("sin energía no se puede calcular", () => {
    expect(distanciaAlObjetivo(macros, 0, { prot: 0.3 })).toBe(Infinity);
  });
});

describe("sustituciones dirigidas a un objetivo", () => {
  // dieta de 1740 kcal con 23% de proteína; se quiere el 35%
  const macrosDieta = { prot: 100, hc: 200, grasa: 60 };
  const energiaDieta = 1740;
  const objetivo = { prot: 0.35, hc: 0.4, grasa: 0.25 };

  it("gana el cambio equilibrado, no el más proteico", () => {
    // La intuición dice «falta proteína, mete pollo». Pero el objetivo son TRES
    // porcentajes a la vez: cambiar 100 g de arroz por 313 g de pollo sube la
    // proteína al 37% y de paso hunde los hidratos del 46% al 28%, catorce
    // puntos por debajo del 40% pedido. Neto: no mejora nada.
    // La quinoa mueve los tres en la dirección correcta sin pasarse.
    const r = rankearHaciaObjetivo(
      ARROZ, 100, [QUINOA, PASTA, POLLO], macrosDieta, energiaDieta, objetivo,
      { maxRelativo: 100 },
    );
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].candidato.nombre).toBe("Quinoa");
    expect(r[0].mejora).toBeGreaterThan(0);
  });

  it("el más proteico apenas acerca, y por eso no se ofrece", () => {
    // Con el umbral por defecto no entra. Bajándolo se ve por qué: mejora 0,1
    // puntos frente a los 2,8 de la quinoa, porque lo que gana en proteína lo
    // pierde en hidratos.
    expect(
      rankearHaciaObjetivo(ARROZ, 100, [POLLO], macrosDieta, energiaDieta, objetivo, {
        maxRelativo: 100,
      }),
    ).toEqual([]);

    const conUmbralBajo = rankearHaciaObjetivo(
      ARROZ, 100, [POLLO], macrosDieta, energiaDieta, objetivo,
      { maxRelativo: 100, mejoraMinima: 0 },
    );
    expect(conUmbralBajo[0].mejora).toBeLessThan(0.5);
  });

  it("una mejora insignificante no se propone", () => {
    const casiIgual = ing(7, "Arroz de otra marca", 7.1, 77.9, 0.6);
    const r = rankearHaciaObjetivo(
      ARROZ, 100, [casiIgual], macrosDieta, energiaDieta, objetivo, { maxRelativo: 100 },
    );
    expect(r).toEqual([]);
  });

  it("nunca propone algo que aleje del objetivo", () => {
    const r = rankearHaciaObjetivo(
      ARROZ, 100, [QUINOA, PASTA, POLLO], macrosDieta, energiaDieta, objetivo,
      { maxRelativo: 100 },
    );
    r.forEach((s) => expect(s.mejora!).toBeGreaterThan(0));
  });

  it("la mejora declarada coincide con la real", () => {
    const r = rankearHaciaObjetivo(
      ARROZ, 100, [QUINOA], macrosDieta, energiaDieta, objetivo, { maxRelativo: 100 },
    );
    const s = r[0];
    const antes = distanciaAlObjetivo(macrosDieta, energiaDieta, objetivo);
    const despues = distanciaAlObjetivo(
      {
        prot: macrosDieta.prot + s.delta.prot,
        hc: macrosDieta.hc + s.delta.hc,
        grasa: macrosDieta.grasa + s.delta.grasa,
      },
      energiaDieta,
      objetivo,
    );
    expect(s.mejora!).toBeCloseTo(antes - despues, 1);
  });

  it("si ya se cumple el objetivo, no hay nada que proponer", () => {
    const pctExacto = {
      prot: (400 / energiaDieta) * 100,
      hc: (800 / energiaDieta) * 100,
      grasa: (540 / energiaDieta) * 100,
    };
    const r = rankearHaciaObjetivo(
      ARROZ, 100, [QUINOA, PASTA, POLLO], macrosDieta, energiaDieta, pctExacto,
      { maxRelativo: 100 },
    );
    expect(r).toEqual([]);
  });

  it("ordena por cuánto acercan", () => {
    const r = rankearHaciaObjetivo(
      ARROZ, 100, [QUINOA, PASTA, POLLO], macrosDieta, energiaDieta, objetivo,
      { maxRelativo: 100 },
    );
    const mejoras = r.map((s) => s.mejora!);
    expect(mejoras).toEqual([...mejoras].sort((a, b) => b - a));
  });

  it("la energía de la dieta no se mueve, que es lo que hace válida la comparación", () => {
    const r = rankearHaciaObjetivo(
      ARROZ, 100, [QUINOA], macrosDieta, energiaDieta, objetivo, { maxRelativo: 100 },
    );
    const s = r[0];
    const deltaEnergia = 4 * s.delta.prot + 4 * s.delta.hc + 9 * s.delta.grasa;
    expect(deltaEnergia).toBeCloseTo(0, 6);
  });
});

/**
 * El fallo de la fase 7 que se vio usándola: el panel ofrecía «los que más
 * acercan al reparto pedido» en sitios donde la respuesta solo podía ser
 * «ningún cambio acerca», y encima aparecía y desaparecía sin explicación.
 *
 * Estas pruebas fijan la regla de cuándo tiene sentido ofrecerlo, y por qué.
 */
describe("cuándo tiene sentido el modo dirigido", () => {
  // Una dieta de 2.000 kcal repartida 25/50/25.
  const dieta: Macros = { prot: 125, hc: 250, grasa: 55.6 };
  const energia = 4 * dieta.prot + 4 * dieta.hc + 9 * dieta.grasa;
  const actual = {
    prot: (400 * dieta.prot) / energia,
    hc: (400 * dieta.hc) / energia,
    grasa: (900 * dieta.grasa) / energia,
  };

  it("sin reparto pedido, no", () => {
    expect(mereceDirigido(dieta, energia, null)).toBe(false);
    expect(mereceDirigido(dieta, energia, undefined)).toBe(false);
    expect(mereceDirigido(dieta, energia, {})).toBe(false);
  });

  it("con el reparto que la dieta YA tiene, tampoco", () => {
    // Éste era el caso de verdad: al activar el control de macros sin pedir
    // otro reparto, la pantalla mandaba el actual como objetivo.
    const mismo = {
      prot: actual.prot / 100,
      hc: actual.hc / 100,
      grasa: actual.grasa / 100,
    };
    expect(distanciaAlObjetivo(dieta, energia, mismo)).toBeCloseTo(0, 6);
    expect(mereceDirigido(dieta, energia, mismo)).toBe(false);
  });

  it("y en esos casos, efectivamente, no hay nada que proponer", () => {
    // La otra mitad de la demostración: no es que se oculte por precaución,
    // es que el cálculo no puede devolver nada.
    const arroz = ing(1, "Arroz", 7, 78, 0.6);
    const otros = [
      ing(2, "Lentejas", 24, 54, 1.8, "Legumbres"),
      ing(3, "Pollo", 22, 0, 2.5, "Carnes y derivados"),
      ing(4, "Pasta", 12, 74, 1.5),
    ];
    const mismo = {
      prot: actual.prot / 100,
      hc: actual.hc / 100,
      grasa: actual.grasa / 100,
    };
    expect(rankearHaciaObjetivo(arroz, 100, otros, dieta, energia, mismo)).toEqual([]);
    expect(rankearHaciaObjetivo(arroz, 100, otros, dieta, energia, {})).toEqual([]);
  });

  it("con un reparto distinto, sí, y entonces hay propuestas", () => {
    const pedido = { prot: 0.35, hc: 0.4, grasa: 0.25 };
    expect(mereceDirigido(dieta, energia, pedido)).toBe(true);

    const arroz = ing(1, "Arroz", 7, 78, 0.6);
    const otros = [
      ing(2, "Lentejas", 24, 54, 1.8, "Legumbres"),
      ing(3, "Pollo", 22, 0, 2.5, "Carnes y derivados"),
    ];
    const r = rankearHaciaObjetivo(arroz, 100, otros, dieta, energia, pedido);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].mejora!).toBeGreaterThan(0);
  });

  it("el margen es el mismo que exige la búsqueda, ni más ni menos", () => {
    // Justo por debajo de la mejora mínima no puede pasar nada el filtro,
    // aunque la sustitución llevara la dieta exactamente al objetivo.
    const casi = { prot: actual.prot / 100 + 0.002, hc: actual.hc / 100, grasa: actual.grasa / 100 };
    const d = distanciaAlObjetivo(dieta, energia, casi);
    expect(d).toBeLessThan(0.5);
    expect(mereceDirigido(dieta, energia, casi)).toBe(false);

    const lejos = { prot: actual.prot / 100 + 0.02, hc: actual.hc / 100, grasa: actual.grasa / 100 };
    expect(distanciaAlObjetivo(dieta, energia, lejos)).toBeGreaterThan(0.5);
    expect(mereceDirigido(dieta, energia, lejos)).toBe(true);
  });

  it("sin energía no se ofrece: no hay reparto que calcular", () => {
    expect(mereceDirigido(dieta, 0, { prot: 0.35 })).toBe(false);
  });

  it("da igual pedir el reparto en tantos por uno o en tantos por ciento", () => {
    expect(mereceDirigido(dieta, energia, { prot: 0.35, hc: 0.4, grasa: 0.25 })).toBe(true);
    expect(mereceDirigido(dieta, energia, { prot: 35, hc: 40, grasa: 25 })).toBe(true);
  });
});
