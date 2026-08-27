/**
 * Comparación de dos versiones de una dieta.
 *
 * El problema no es restar gramos: es **casar los componentes**. Al guardar un
 * ajuste se clona la dieta, así que la versión nueva tiene los mismos alimentos
 * con identificadores distintos. Emparejar por id no vale; hay que hacerlo por
 * comida e ingrediente.
 *
 * Y hay que contemplar que entre una versión y otra se haya añadido o quitado
 * algo, porque nada impide editar una versión después de crearla. Un comparador
 * que solo reste gramos se dejaría eso fuera en silencio, que es justo el tipo
 * de cosa que hace desconfiar de una herramienta.
 */

import { FACTORES } from "@/lib/motor";
import { aNumero, componentesActivos } from "./mapeo";
import type { DietaCompleta, FilaComponente, FilaIngrediente } from "./tipos";

export type EstadoLinea = "igual" | "cambia" | "anadido" | "quitado";

export interface LineaComparacion {
  comida: string;
  ingrediente: string;
  ingredienteId: number;
  gramosA: number | null;
  gramosB: number | null;
  kcalA: number;
  kcalB: number;
  deltaG: number;
  deltaKcal: number;
  estado: EstadoLinea;
}

export interface Totales {
  kcal: number;
  prot: number;
  hc: number;
  grasa: number;
  fibra: number;
  pct: { prot: number; hc: number; grasa: number };
}

export interface GrupoComida {
  comida: string;
  kcalA: number;
  kcalB: number;
  lineas: LineaComparacion[];
}

export interface Comparacion {
  grupos: GrupoComida[];
  lineas: LineaComparacion[];
  totalA: Totales;
  totalB: Totales;
  hayCambios: boolean;
  nAnadidos: number;
  nQuitados: number;
}

type Comp = FilaComponente & { ingredientes: FilaIngrediente };

const kcalDe = (c: Comp) =>
  (aNumero(c.gramos, "gramos") * aNumero(c.ingredientes.kcal_100, "kcal_100")) / 100;

function totales(d: DietaCompleta): Totales {
  let kcal = 0, prot = 0, hc = 0, grasa = 0, fibra = 0;
  for (const m of d.comidas ?? []) {
    // Solo la opción activa, como `aDieta`. Sumando todas, una comida con dos
    // opciones contaría dos desayunos y la comparación entre versiones diría
    // que la dieta ha engordado el día que se añadió una alternativa.
    for (const c of componentesActivos(m)) {
      const g = aNumero(c.gramos, "gramos") / 100;
      const i = c.ingredientes;
      kcal += g * aNumero(i.kcal_100, "kcal_100");
      prot += g * aNumero(i.prot_100, "prot_100");
      hc += g * aNumero(i.hc_100, "hc_100");
      grasa += g * aNumero(i.grasa_100, "grasa_100");
      fibra += g * (Number(i.fibra_100) || 0);
    }
  }
  const pct =
    kcal > 0
      ? {
          prot: (100 * FACTORES.prot * prot) / kcal,
          hc: (100 * FACTORES.hc * hc) / kcal,
          grasa: (100 * FACTORES.grasa * grasa) / kcal,
        }
      : { prot: 0, hc: 0, grasa: 0 };
  return { kcal, prot, hc, grasa, fibra, pct };
}

/** Componentes de una dieta agrupados por nombre de comida. */
function porComida(d: DietaCompleta): Map<string, Comp[]> {
  const fuera = new Map<string, Comp[]>();
  const comidas = [...(d.comidas ?? [])].sort(
    (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre),
  );
  for (const m of comidas) {
    fuera.set(m.nombre, (fuera.get(m.nombre) ?? []).concat(componentesActivos(m) as Comp[]));
  }
  return fuera;
}

export function compararDietas(a: DietaCompleta, b: DietaCompleta): Comparacion {
  const mapaA = porComida(a);
  const mapaB = porComida(b);

  // Orden: primero las comidas de A tal y como vienen, luego las que solo
  // estén en B. Así la vista sigue el orden del día en el caso normal.
  const nombres = [...mapaA.keys()];
  for (const n of mapaB.keys()) if (!nombres.includes(n)) nombres.push(n);

  const grupos: GrupoComida[] = [];
  let nAnadidos = 0;
  let nQuitados = 0;

  for (const comida of nombres) {
    const listaA = mapaA.get(comida) ?? [];
    const listaB = mapaB.get(comida) ?? [];

    // Cola por ingrediente: si el mismo alimento aparece dos veces en la misma
    // comida, se emparejan en orden de aparición.
    const pendientesB = new Map<number, Comp[]>();
    for (const c of listaB) {
      const k = c.ingrediente_id;
      if (!pendientesB.has(k)) pendientesB.set(k, []);
      pendientesB.get(k)!.push(c);
    }

    const lineas: LineaComparacion[] = [];

    for (const ca of listaA) {
      const cola = pendientesB.get(ca.ingrediente_id);
      const cb = cola && cola.length ? cola.shift()! : null;
      const gA = aNumero(ca.gramos, "gramos");
      const kA = kcalDe(ca);
      if (cb) {
        const gB = aNumero(cb.gramos, "gramos");
        const kB = kcalDe(cb);
        lineas.push({
          comida,
          ingrediente: ca.ingredientes.nombre,
          ingredienteId: ca.ingrediente_id,
          gramosA: gA,
          gramosB: gB,
          kcalA: kA,
          kcalB: kB,
          deltaG: gB - gA,
          deltaKcal: kB - kA,
          estado: Math.abs(gB - gA) < 0.005 ? "igual" : "cambia",
        });
      } else {
        nQuitados++;
        lineas.push({
          comida,
          ingrediente: ca.ingredientes.nombre,
          ingredienteId: ca.ingrediente_id,
          gramosA: gA,
          gramosB: null,
          kcalA: kA,
          kcalB: 0,
          deltaG: -gA,
          deltaKcal: -kA,
          estado: "quitado",
        });
      }
    }

    // Lo que queda en B sin pareja son altas.
    for (const cb of listaB) {
      const cola = pendientesB.get(cb.ingrediente_id);
      if (!cola || !cola.includes(cb)) continue;
      cola.splice(cola.indexOf(cb), 1);
      const gB = aNumero(cb.gramos, "gramos");
      const kB = kcalDe(cb);
      nAnadidos++;
      lineas.push({
        comida,
        ingrediente: cb.ingredientes.nombre,
        ingredienteId: cb.ingrediente_id,
        gramosA: null,
        gramosB: gB,
        kcalA: 0,
        kcalB: kB,
        deltaG: gB,
        deltaKcal: kB,
        estado: "anadido",
      });
    }

    if (lineas.length)
      grupos.push({
        comida,
        kcalA: lineas.reduce((s, l) => s + l.kcalA, 0),
        kcalB: lineas.reduce((s, l) => s + l.kcalB, 0),
        lineas,
      });
  }

  const lineas = grupos.flatMap((g) => g.lineas);
  return {
    grupos,
    lineas,
    totalA: totales(a),
    totalB: totales(b),
    hayCambios: lineas.some((l) => l.estado !== "igual"),
    nAnadidos,
    nQuitados,
  };
}
