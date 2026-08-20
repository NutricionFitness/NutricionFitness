import { describe, expect, it } from "vitest";

import { ajustar, energia } from "@/lib/motor";
import {
  aComponente,
  aDieta,
  aFilaAjuste,
  aIngrediente,
  aNumero,
  aNumeroOpcional,
  ErrorMapeo,
  gramosAGuardar,
} from "./mapeo";
import type { DietaCompleta, FilaIngrediente } from "./tipos";

const ing = (id: number, nombre: string, p: unknown, h: unknown, g: unknown): FilaIngrediente =>
  ({
    id,
    owner_id: null,
    codigo_bedca: String(id),
    nombre,
    nombre_norm: nombre.toLowerCase(),
    nombre_en: null,
    grupo: "Cereales y derivados",
    estado: "crudo",
    prot_100: p as number,
    hc_100: h as number,
    grasa_100: g as number,
    fibra_100: 0,
    alcohol_100: 0,
    ags_100: null,
    agua_100: null,
    sodio_100: null,
    kcal_ref: null,
    kcal_100: 0,
    porcion_comestible: 1,
    origen: "BEDCA",
    preferente: true,
    revisado: false,
  }) as FilaIngrediente;

const dietaBase = (): DietaCompleta =>
  ({
    id: "d1",
    owner_id: "u1",
    persona_id: "p1",
    nombre: "Dieta",
    descripcion: null,
    modelo_energia: "atwater",
    estado_cantidades: "crudo",
    kcal_objetivo: null,
    version: 1,
    dieta_padre_id: null,
    archivada: false,
    creado_en: "2026-08-20",
    comidas: [
      {
        id: "m2",
        dieta_id: "d1",
        nombre: "Cena",
        orden: 1,
        componentes: [
          {
            id: "c3",
            comida_id: "m2",
            ingrediente_id: 3,
            // PostgreSQL manda los numeric como CADENA
            gramos: "150" as unknown as number,
            orden: 0,
            bloqueado: false,
            prioridad: "1" as unknown as number,
            min_g: null,
            max_g: null,
            paso_g: "5" as unknown as number,
            ingredientes: ing(3, "Merluza", "17", "0", "1.8"),
          },
        ],
      },
      {
        id: "m1",
        dieta_id: "d1",
        nombre: "Comida",
        orden: 0,
        componentes: [
          {
            id: "c2",
            comida_id: "m1",
            ingrediente_id: 2,
            gramos: "10" as unknown as number,
            orden: 1,
            bloqueado: true,
            prioridad: "1" as unknown as number,
            min_g: null,
            max_g: null,
            paso_g: "1" as unknown as number,
            ingredientes: ing(2, "Aceite de oliva", "0", "0", "99.9"),
          },
          {
            id: "c1",
            comida_id: "m1",
            ingrediente_id: 1,
            gramos: "80" as unknown as number,
            orden: 0,
            bloqueado: false,
            prioridad: "4" as unknown as number,
            min_g: "60" as unknown as number,
            max_g: "120" as unknown as number,
            paso_g: "5" as unknown as number,
            ingredientes: ing(1, "Arroz", "7", "78", "0.6"),
          },
        ],
      },
    ],
  }) as unknown as DietaCompleta;

describe("conversión de números", () => {
  it("acepta las cadenas que devuelve PostgreSQL", () => {
    expect(aNumero("80")).toBe(80);
    expect(aNumero(80)).toBe(80);
    expect(aNumero("99.9")).toBeCloseTo(99.9, 9);
  });

  it("rechaza nulos y basura en vez de colar un NaN", () => {
    expect(() => aNumero(null, "gramos")).toThrow(/gramos es nulo/);
    expect(() => aNumero("ocho", "gramos")).toThrow(/no es un número/);
    expect(aNumeroOpcional(null)).toBeNull();
    expect(aNumeroOpcional("")).toBeNull();
    expect(aNumeroOpcional("3.5")).toBeCloseTo(3.5, 9);
  });

  it("una cadena sin convertir concatenaría en vez de sumar", () => {
    // Esta es exactamente la avería que evita aNumero.
    expect(("80" as unknown as number) + ("10" as unknown as number)).toBe("8010");
  });
});

describe("ingredientes y componentes", () => {
  it("convierte un ingrediente con sus valores por defecto", () => {
    const i = aIngrediente(ing(1, "Arroz", "7", "78", "0.6"));
    expect(i.nombre).toBe("Arroz");
    expect(i.prot).toBe(7);
    expect(i.fibra).toBe(0);
    expect(i.alcohol).toBe(0);
  });

  it("un componente sin ingrediente es un error explícito", () => {
    const roto = { id: "c9", ingredientes: undefined } as never;
    expect(() => aComponente(roto, "Comida")).toThrow(ErrorMapeo);
  });
});

describe("dieta completa", () => {
  it("ordena las comidas y los componentes de forma estable", () => {
    const { dieta, idsComponentes } = aDieta(dietaBase());
    expect(dieta.componentes.map((c) => c.ingrediente.nombre)).toEqual([
      "Arroz",
      "Aceite de oliva",
      "Merluza",
    ]);
    expect(idsComponentes).toEqual(["c1", "c2", "c3"]);
    expect(dieta.componentes.map((c) => c.comida)).toEqual(["Comida", "Comida", "Cena"]);
  });

  it("el orden no depende de cómo venga la consulta", () => {
    const d = dietaBase();
    d.comidas.reverse();
    d.comidas.forEach((m) => m.componentes.reverse());
    expect(aDieta(d).idsComponentes).toEqual(["c1", "c2", "c3"]);
  });

  it("conserva las reglas de ajuste", () => {
    const { dieta } = aDieta(dietaBase());
    const [arroz, aceite] = dieta.componentes;
    expect(arroz.prioridad).toBe(4);
    expect(arroz.minG).toBe(60);
    expect(arroz.maxG).toBe(120);
    expect(aceite.bloqueado).toBe(true);
    expect(aceite.pasoG).toBe(1);
  });

  it("la energía sale bien pese a que todo venía como cadena", () => {
    const { dieta } = aDieta(dietaBase());
    const esperado =
      (80 * (4 * 7 + 4 * 78 + 9 * 0.6)) / 100 +
      (10 * (9 * 99.9)) / 100 +
      (150 * (4 * 17 + 9 * 1.8)) / 100;
    expect(energia(dieta)).toBeCloseTo(esperado, 6);
  });

  it("una dieta sin componentes se rechaza con un mensaje entendible", () => {
    const d = dietaBase();
    d.comidas.forEach((m) => (m.componentes = []));
    expect(() => aDieta(d)).toThrow(/no tiene componentes/);
  });
});

describe("vuelta a la base", () => {
  it("cada resultado vuelve a su fila", () => {
    const { dieta, idsComponentes } = aDieta(dietaBase());
    const res = ajustar(dieta, energia(dieta) - 100, { modo: "prioridades" });
    const filas = gramosAGuardar(res, idsComponentes);
    expect(filas.map((f) => f.id)).toEqual(["c1", "c2", "c3"]);
    // el aceite estaba bloqueado: no puede haberse movido
    expect(filas[1].gramos).toBe(10);
    // y nada tiene más de dos decimales, que es lo que admite la columna
    filas.forEach((f) => expect(Math.round(f.gramos * 100)).toBe(f.gramos * 100));
  });

  it("si el orden se pierde, se nota en vez de guardar gramos cruzados", () => {
    const { dieta, idsComponentes } = aDieta(dietaBase());
    const res = ajustar(dieta, energia(dieta) - 50);
    expect(() => gramosAGuardar(res, idsComponentes.slice(0, 2))).toThrow(/orden se ha perdido/);
  });

  it("la fila de historial recoge lo esencial", () => {
    const { dieta } = aDieta(dietaBase());
    const res = ajustar(dieta, energia(dieta) - 100, { modo: "prioridades" });
    const fila = aFilaAjuste(res, "d1", "prioridades", { holguraRel: 0.4 });
    expect(fila.dieta_id).toBe("d1");
    expect(fila.factible).toBe(true);
    expect(fila.kcal_final).not.toBeNull();
    expect(fila.resultado.cambios).toHaveLength(3);
    expect(fila.parametros).toEqual({ holguraRel: 0.4 });
  });

  it("un ajuste infactible también se guarda, sin kcal final", () => {
    const { dieta } = aDieta(dietaBase());
    const res = ajustar(dieta, 10);
    expect(res.factible).toBe(false);
    const fila = aFilaAjuste(res, "d1", "prioridades", {});
    expect(fila.factible).toBe(false);
    expect(fila.kcal_final).toBeNull();
    expect(fila.motivo).toContain("rango alcanzable");
  });
});
