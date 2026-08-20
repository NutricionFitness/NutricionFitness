/**
 * Traducción entre las filas de la base y los objetos del motor.
 *
 * El motor no sabe qué es Supabase ni piensa hacerlo. Toda la conversión vive
 * aquí, en un módulo sin dependencias de red, para poder probarla a fondo.
 *
 * Dos cuidados que no son obvios:
 *
 *  1. PostgreSQL devuelve los `numeric` como CADENAS en JSON, para no perder
 *     precisión. Si se meten tal cual en el motor, `80` + `10` da `"8010"`.
 *     Todo número pasa por `aNumero`.
 *  2. El orden de los componentes tiene que ser estable. El motor devuelve sus
 *     resultados en el mismo orden en que recibe la dieta, y ese orden es el que
 *     se usa para volver a casar cada resultado con su fila.
 */

import type { Componente, Dieta, Ingrediente, Resultado } from "@/lib/motor";
import type {
  DietaCompleta,
  FilaComponente,
  FilaIngrediente,
} from "./tipos";

export class ErrorMapeo extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorMapeo";
  }
}

/** Los `numeric` de PostgreSQL llegan como cadena. */
export function aNumero(v: unknown, campo = "valor"): number {
  if (v === null || v === undefined) throw new ErrorMapeo(`${campo} es nulo`);
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new ErrorMapeo(`${campo} no es un número: ${String(v)}`);
  return n;
}

export function aNumeroOpcional(v: unknown, campo = "valor"): number | null {
  if (v === null || v === undefined || v === "") return null;
  return aNumero(v, campo);
}

export function aIngrediente(f: FilaIngrediente): Ingrediente {
  return {
    id: f.id,
    nombre: f.nombre,
    prot: aNumero(f.prot_100, "prot_100"),
    hc: aNumero(f.hc_100, "hc_100"),
    grasa: aNumero(f.grasa_100, "grasa_100"),
    fibra: aNumeroOpcional(f.fibra_100, "fibra_100") ?? 0,
    alcohol: aNumeroOpcional(f.alcohol_100, "alcohol_100") ?? 0,
    kcalRef: aNumeroOpcional(f.kcal_ref, "kcal_ref"),
    grupo: f.grupo,
    estado: f.estado ?? "desconocido",
  };
}

export function aComponente(
  f: FilaComponente & { ingredientes: FilaIngrediente },
  comida: string,
): Componente {
  if (!f.ingredientes)
    throw new ErrorMapeo(`el componente ${f.id} llega sin su ingrediente`);
  return {
    ingrediente: aIngrediente(f.ingredientes),
    gramos: aNumero(f.gramos, "gramos"),
    comida,
    bloqueado: Boolean(f.bloqueado),
    prioridad: aNumeroOpcional(f.prioridad, "prioridad") ?? 1,
    minG: aNumeroOpcional(f.min_g, "min_g"),
    maxG: aNumeroOpcional(f.max_g, "max_g"),
    pasoG: aNumeroOpcional(f.paso_g, "paso_g") ?? 5,
  };
}

/**
 * Convierte la dieta que devuelve la base en la que consume el motor, y
 * devuelve además los ids en el mismo orden, que es lo que permite volver a
 * casar cada resultado con su fila al guardar.
 */
export function aDieta(d: DietaCompleta): { dieta: Dieta; idsComponentes: string[] } {
  const comidas = [...(d.comidas ?? [])].sort(
    (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre),
  );
  const componentes: Componente[] = [];
  const idsComponentes: string[] = [];
  for (const m of comidas) {
    const suyos = [...(m.componentes ?? [])].sort(
      (a, b) => a.orden - b.orden || a.id.localeCompare(b.id),
    );
    for (const c of suyos) {
      componentes.push(aComponente(c, m.nombre));
      idsComponentes.push(c.id);
    }
  }
  if (componentes.length === 0)
    throw new ErrorMapeo(`la dieta "${d.nombre}" no tiene componentes`);

  return {
    dieta: {
      nombre: d.nombre,
      modeloEnergia: d.modelo_energia ?? "atwater",
      componentes,
    },
    idsComponentes,
  };
}

/** Los gramos nuevos, listos para actualizar fila a fila. */
export function gramosAGuardar(
  res: Resultado,
  idsComponentes: string[],
): Array<{ id: string; gramos: number }> {
  if (res.cambios.length !== idsComponentes.length)
    throw new ErrorMapeo(
      `el resultado trae ${res.cambios.length} componentes y la dieta tiene ` +
        `${idsComponentes.length}: el orden se ha perdido`,
    );
  return res.cambios.map((c, i) => ({
    id: idsComponentes[i],
    gramos: Math.round(c.gramosDespues * 100) / 100, // numeric(9,2) en la base
  }));
}

/** Fila para la tabla `ajustes`. Guarda también los infactibles: saber que se
 *  intentó y no se pudo es información. */
export function aFilaAjuste(
  res: Resultado,
  dietaId: string,
  modo: string,
  parametros: Record<string, unknown>,
  dietaResultadoId: string | null = null,
) {
  return {
    dieta_id: dietaId,
    dieta_resultado_id: dietaResultadoId,
    kcal_origen: Math.round(res.energiaInicial * 100) / 100,
    kcal_objetivo: Math.round(res.objetivoKcal * 100) / 100,
    kcal_final: res.factible ? Math.round(res.energiaFinal * 100) / 100 : null,
    modo,
    parametros,
    resultado: {
      cambios: res.cambios.map((c) => ({
        nombre: c.nombre,
        comida: c.comida,
        antes: c.gramosAntes,
        despues: c.gramosDespues,
        delta_kcal: c.deltaKcal,
        en_limite: c.enLimite,
      })),
      macros_final: res.macrosFinal,
      pct_final: res.pctFinal,
      rango: res.rangoAlcanzable,
      avisos: res.avisos,
    },
    factible: res.factible,
    motivo: res.motivo || null,
  };
}
