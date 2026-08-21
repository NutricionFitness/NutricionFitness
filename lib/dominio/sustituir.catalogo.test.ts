/**
 * Sustituciones contra el catálogo REAL de BEDCA.
 *
 * Los tests unitarios usan cuatro alimentos inventados con números redondos.
 * Estos usan los 1.090 del catálogo efectivo, que es donde aparecen las
 * sorpresas: la primera versión proponía 258 g de café soluble para subir la
 * proteína. Nutricionalmente encaja; como consejo es absurdo.
 */

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  rankearHaciaObjetivo,
  rankearSustitutos,
  type Candidato,
} from "./sustituir";

const paquete = JSON.parse(
  gunzipSync(readFileSync("supabase/datos/ingredientes.json.gz")).toString(),
);

const CATALOGO: Candidato[] = paquete.ingredientes
  .filter((i: { preferente: boolean }) => i.preferente)
  .map((i: Record<string, number & string>, ix: number) => ({
    id: ix + 1,
    nombre: i.nombre,
    grupo: i.grupo,
    estado: i.estado,
    prot: i.prot_100,
    hc: i.hc_100,
    grasa: i.grasa_100,
    kcal100: 4 * i.prot_100 + 4 * i.hc_100 + 9 * i.grasa_100,
  }));

const buscar = (n: string) =>
  CATALOGO.find((c) => c.nombre.toLowerCase().startsWith(n.toLowerCase()))!;

describe("sustitutos dentro del grupo", () => {
  it.each(["Arroz", "Merluza fresca", "Pan blanco, de barra"])(
    "%s tiene sustitutos isoenergéticos y del mismo grupo",
    (nombre) => {
      const a = buscar(nombre);
      const mismoGrupo = CATALOGO.filter((c) => c.grupo === a.grupo);
      const r = rankearSustitutos(a, 80, mismoGrupo, { limite: 5 });

      expect(r.length).toBeGreaterThan(0);
      const kcalOriginal = (80 * a.kcal100) / 100;
      for (const s of r) {
        expect((s.gramos * s.candidato.kcal100) / 100).toBeCloseTo(kcalOriginal, 0);
        expect(s.candidato.grupo).toBe(a.grupo);
        expect(s.candidato.id).not.toBe(a.id);
      }
    },
  );
});

describe("sustituciones dirigidas sobre el catálogo real", () => {
  const macrosDieta = { prot: 100, hc: 200, grasa: 60 };
  const energiaDieta = 1740; // 23% prot · 46% HC · 31% grasa
  const objetivo = { prot: 0.35, hc: 0.4, grasa: 0.25 };

  const propuestas = () =>
    rankearHaciaObjetivo(
      buscar("Arroz"), 80, CATALOGO, macrosDieta, energiaDieta, objetivo, { limite: 6 },
    );

  it("recomienda legumbres, que es la respuesta correcta de manual", () => {
    // Subir proteína sin hundir los hidratos es exactamente lo que hace una
    // legumbre. Que salga sin habérselo dicho es buena señal.
    const r = propuestas();
    expect(r.length).toBeGreaterThan(0);
    const primeros = r.slice(0, 3).map((s) => s.candidato.nombre.toLowerCase());
    expect(primeros.some((n) => /jud[íi]a|alubia|lenteja|garbanzo/.test(n))).toBe(true);
  });

  it("no propone cosas que nadie come en esa cantidad", () => {
    const r = propuestas();
    for (const s of r) {
      expect(s.gramos).toBeLessThanOrEqual(500);
      // café soluble, cubitos de caldo, levadura… buen perfil por 100 g y
      // ninguna posibilidad de acabar en un plato
      expect(["Bebidas", "Salsas y condimentos", "Suplementos"]).not.toContain(
        s.candidato.grupo,
      );
    }
  });

  it("todas mejoran de verdad y están ordenadas", () => {
    const r = propuestas();
    const mejoras = r.map((s) => s.mejora!);
    mejoras.forEach((m) => expect(m).toBeGreaterThanOrEqual(0.5));
    expect(mejoras).toEqual([...mejoras].sort((a, b) => b - a));
  });

  it("y ninguna mueve la energía de la dieta", () => {
    for (const s of propuestas()) {
      const deltaEnergia = 4 * s.delta.prot + 4 * s.delta.hc + 9 * s.delta.grasa;
      expect(deltaEnergia).toBeCloseTo(0, 6);
    }
  });
});
