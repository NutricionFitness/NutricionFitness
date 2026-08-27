"use server";

import {
  rankearPorMacro,
  rankearSustitutos,
  type Candidato,
  type Direccion,
} from "@/lib/dominio/sustituir";
import { normalizarNombre } from "@/app/ingredientes/tipos";
import { clienteServidor } from "@/lib/supabase/servidor";
import type { AlimentoPublico, Orden, PaginaSustitutos } from "./tipos";

/**
 * Lo que el comparador público puede pedirle a la base.
 *
 * Dos llamadas y ninguna tabla: `buscar_alimentos_publico` y
 * `candidatos_publicos` son funciones `SECURITY DEFINER` de la migración 0011,
 * y son la superficie completa de lo que puede hacer alguien sin sesión. El
 * porqué está escrito en esa migración; aquí solo se llaman.
 *
 * El cálculo lo hace `lib/dominio/sustituir`, el mismo que dentro de una dieta.
 * No hay una segunda implementación «para la página pública»: si un día se
 * afina el filtro de los sustitutos, se afina en los dos sitios a la vez.
 */

type FilaBusqueda = {
  id: number; nombre: string; grupo: string | null; estado: string | null;
  prot_100: unknown; hc_100: unknown; grasa_100: unknown;
  fibra_100: unknown; alcohol_100: unknown; kcal_100: unknown;
  kcal_ref: unknown; porcion_comestible: unknown; codigo_bedca: string | null;
};

/** Los `numeric` de PostgreSQL llegan como cadena. */
const num = (v: unknown): number => Number(v ?? 0);
const numOpt = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

function aAlimento(f: FilaBusqueda): AlimentoPublico {
  return {
    id: Number(f.id),
    nombre: f.nombre,
    grupo: f.grupo,
    estado: f.estado ?? "desconocido",
    prot: num(f.prot_100),
    hc: num(f.hc_100),
    grasa: num(f.grasa_100),
    fibra: num(f.fibra_100),
    alcohol: num(f.alcohol_100),
    kcal100: num(f.kcal_100),
    kcalRef: numOpt(f.kcal_ref),
    porcionComestible: numOpt(f.porcion_comestible),
    codigoBedca: f.codigo_bedca,
  };
}

/**
 * Busca alimentos por nombre.
 *
 * El texto se normaliza aquí —minúsculas y sin tildes— con la **misma** función
 * que escribe la columna `nombre_norm`. Si se normalizara de otra manera,
 * «platano» dejaría de encontrar «Plátano» sin que nada diera error.
 */
export async function buscarAlimentos(texto: string): Promise<AlimentoPublico[]> {
  const q = normalizarNombre(texto ?? "").trim();
  if (q.length < 2) return [];

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("buscar_alimentos_publico", {
    texto: q,
    limite: 20,
  });
  if (error || !data) return [];
  return (data as FilaBusqueda[]).map(aAlimento);
}

const DIRECCIONES: Record<Exclude<Orden, "parecido">, Direccion> = {
  mas_prot: { macro: "prot", sentido: "mas" },
  menos_prot: { macro: "prot", sentido: "menos" },
  mas_hc: { macro: "hc", sentido: "mas" },
  menos_hc: { macro: "hc", sentido: "menos" },
  mas_grasa: { macro: "grasa", sentido: "mas" },
  menos_grasa: { macro: "grasa", sentido: "menos" },
};

/**
 * Los sustitutos de un alimento, de diez en diez.
 *
 * Se puntúa el catálogo entero y se devuelve la página pedida. Puntuar mil
 * candidatos son unos milisegundos, así que no compensa guardar nada entre
 * llamadas: «buscar más» vuelve a puntuar y corta más abajo, y así el resultado
 * no depende de un estado que puede haber caducado.
 */
export async function sustitutosPublicos(datos: {
  alimento: AlimentoPublico;
  gramos: number;
  soloMismoGrupo: boolean;
  orden: Orden;
  /** Cuántos saltarse: 0 para los diez primeros, 10 para los siguientes. */
  desde?: number;
}): Promise<PaginaSustitutos> {
  const vacio: PaginaSustitutos = { sustitutos: [], total: 0, mirados: 0 };
  if (!(datos.gramos > 0) || !(datos.alimento.kcal100 > 0)) return vacio;

  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("candidatos_publicos", {
    grupo_filtro: datos.soloMismoGrupo ? datos.alimento.grupo : null,
  });
  if (error || !data) return vacio;

  const candidatos = (data as Array<{
    id: number; nombre: string; grupo: string | null; estado: string | null;
    prot_100: unknown; hc_100: unknown; grasa_100: unknown; kcal_100: unknown;
  }>).map((f) => ({
    id: Number(f.id),
    nombre: f.nombre,
    grupo: f.grupo,
    estado: f.estado ?? "desconocido",
    prot: num(f.prot_100),
    hc: num(f.hc_100),
    grasa: num(f.grasa_100),
    kcal100: num(f.kcal_100),
  }));

  const yo: Candidato = {
    id: datos.alimento.id,
    nombre: datos.alimento.nombre,
    grupo: datos.alimento.grupo,
    estado: datos.alimento.estado,
    prot: datos.alimento.prot,
    hc: datos.alimento.hc,
    grasa: datos.alimento.grasa,
    kcal100: datos.alimento.kcal100,
  };

  // Se pide todo y se corta aquí: `limite` alto, no «diez». Así se puede decir
  // cuántos hay en total, que es lo que hace honesto el botón de «buscar más»
  // —y lo que permite apagarlo cuando ya no queda nada—.
  //
  // Y la banda de cantidad se aprieta a la mitad y el doble, en vez del cuarto
  // y el cuádruple que usa el panel de dentro de una dieta. Ahí la pregunta es
  // «no tengo esto, ¿qué pongo?» y una cantidad rara puede valer; aquí la
  // pregunta es «¿por qué lo cambio?», y la respuesta tiene que ser una ración
  // parecida. Medido contra el catálogo: con la banda ancha, «arroz con más
  // proteína» contestaba **297 g de ajo**; con ésta, sémola y cereales, y «pan
  // con más proteína» contesta guisante, judías y lentejas.
  const opciones = { limite: 500, minRelativo: 0.5, maxRelativo: 2 };
  const todos =
    datos.orden === "parecido"
      ? rankearSustitutos(yo, datos.gramos, candidatos, opciones)
      : rankearPorMacro(yo, datos.gramos, candidatos, DIRECCIONES[datos.orden], opciones);

  const desde = Math.max(0, datos.desde ?? 0);
  return {
    sustitutos: todos.slice(desde, desde + 10),
    total: todos.length,
    mirados: candidatos.length,
  };
}
