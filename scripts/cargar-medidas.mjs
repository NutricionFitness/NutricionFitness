#!/usr/bin/env node
/**
 * Siembra las medidas caseras y las equivalencias crudo ↔ cocido.
 *
 *     node scripts/cargar-medidas.mjs
 *
 * Se ejecuta DESPUÉS de cargar-ingredientes.mjs, porque trabaja sobre el
 * catálogo ya cargado. Es idempotente.
 *
 * Los factores de cocción no están escritos a mano: se deducen del balance de
 * materia seca de la propia BEDCA,
 *
 *     factor = (100 − agua_crudo) / (100 − agua_cocido)
 *
 * que es cuántos gramos de producto cocido salen de un gramo crudo suponiendo
 * que solo se pierde o se gana agua. Esa suposición se rompe al freír (entra
 * aceite) y cuando la pareja mezcla dos métodos de cocinado distintos, así que
 * hay dos filtros: los fritos quedan fuera, y cada factor tiene que caer dentro
 * de lo plausible PARA SU TIPO DE ALIMENTO. Lo que se descarta se dice; un
 * factor mal puesto cambia una dieta en silencio, que es lo peor que puede pasar.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

// --- medidas caseras: patrón sobre el nombre → medida y gramos --------------
const MEDIDAS = [
  [/^huevo(,| de gallina| entero| crudo| fresco|$)/, "unidad (M)", 53],
  [/^clara de huevo/, "clara de 1 huevo", 33],
  [/^yema/, "yema de 1 huevo", 19],
  [/^yogur/, "unidad", 125],
  [/^leche/, "vaso (200 ml)", 206],
  [/^queso.*loncha/, "loncha", 20],
  [/^pan.*molde/, "rebanada", 30],
  [/^pan (blanco)?,? ?de barra/, "rebanada", 25],
  [/^aceite/, "cucharada", 9],
  [/^mantequilla|^margarina/, "porción", 10],
  [/^azucar/, "cucharadita", 5],
  [/^miel|^mermelada|^confitura/, "cucharada", 20],
  [/^platano/, "unidad", 100],
  [/^manzana/, "unidad", 130],
  [/^naranja/, "unidad", 140],
  [/^mandarina/, "unidad", 70],
  [/^pera/, "unidad", 140],
  [/^kiwi/, "unidad", 75],
  [/^melocoton/, "unidad", 130],
  [/^fresa|^freson/, "unidad", 12],
  [/^tomate/, "unidad mediana", 120],
  [/^patata/, "unidad mediana", 150],
  [/^zanahoria/, "unidad", 80],
  [/^cebolla/, "unidad mediana", 130],
  [/^arroz/, "cazo (en crudo)", 70],
  [/^pasta|^macarron|^espagueti|^fideo/, "ración (en crudo)", 80],
  [/^lenteja|^garbanzo|^alubia|^judias? (blanca|pinta)/, "cazo (en seco)", 70],
  [/^avena|^copos/, "cucharada", 15],
  [/^galleta/, "unidad", 8],
  [/^nuez|^nueces/, "unidad", 5],
  [/^almendra|^avellana|^pistacho|^anacardo/, "puñado", 25],
  [/^jamon (serrano|curado|iberico)/, "loncha", 15],
  [/^jamon cocido|^pavo, fiambre/, "loncha", 25],
  [/^atun.*(lata|conserva)|^bonito.*lata/, "lata escurrida", 52],
  [/^cerveza/, "caña (200 ml)", 200],
  [/^vino/, "copa (100 ml)", 100],
  [/^cafe.*(infusion|bebida)/, "taza (125 ml)", 125],
  [/^pizza/, "porción", 100],
  [/^croqueta/, "unidad", 30],
  [/^chocolate/, "onza", 8],
];

// --- rangos plausibles del factor de cocción, por tipo de alimento -----------
const BANDAS = {
  "Carnes y derivados": [0.55, 1.05],
  "Pescados y mariscos": [0.55, 1.1],
  Huevos: [0.8, 1.05],
  "Cereales y derivados": [1.5, 4.0],
  Legumbres: [1.5, 4.0],
  "Verduras y hortalizas": [0.6, 1.3],
  Frutas: [0.6, 1.3],
};
const BANDA_POR_DEFECTO = [0.5, 4.0];

const CRUDO = /\b(crud[ao]s?|fresc[ao]s?)\b/;
const COCIDO = /\b(cocid[ao]s?|hervid[ao]s?|asad[ao]s?|a la plancha|al vapor|al horno|horne[ao])\b/;
const FRITO = /\b(frit[ao]s?|rebozad|empanad)\b/;

const sinTildes = (s) => (s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const claveSinEstado = (nombre) =>
  sinTildes(nombre).replace(CRUDO, "").replace(COCIDO, "").replace(/[,.]+/g, " ")
    .replace(/\s+/g, " ").trim().replace(/^[ ,-]+|[ ,-]+$/g, "");

function cargarEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      for (const linea of readFileSync(resolve(AQUI, "..", f), "utf8").split("\n")) {
        const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* puede no existir */ }
  }
}

async function main() {
  cargarEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const supabase = createClient(url, clave, { auth: { persistSession: false } });

  // Traer el catálogo compartido por páginas: Supabase corta en 1.000 filas.
  const ingredientes = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase
      .from("ingredientes")
      .select("id, nombre, estado, grupo, agua_100, preferente")
      .is("owner_id", null)
      .order("id")
      .range(desde, desde + 999);
    if (error) throw new Error(error.message);
    ingredientes.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`catálogo: ${ingredientes.length} ingredientes`);
  if (!ingredientes.length) {
    console.error("El catálogo está vacío. Ejecuta antes cargar-ingredientes.mjs");
    process.exit(1);
  }

  // ------------------------------------------------------------ medidas
  const medidas = [];
  for (const i of ingredientes) {
    const n = sinTildes(i.nombre);
    for (const [patron, nombre, gramos] of MEDIDAS) {
      if (patron.test(n)) {
        medidas.push({ ingrediente_id: i.id, owner_id: null, nombre, gramos, orden: 0 });
        break;
      }
    }
  }
  console.log(`medidas caseras: ${medidas.length} (${Math.round((100 * medidas.length) / ingredientes.length)}% del catálogo)`);

  for (let i = 0; i < medidas.length; i += 500) {
    const { error } = await supabase
      .from("medidas_caseras")
      .upsert(medidas.slice(i, i + 500), { onConflict: "ingrediente_id,owner_id,nombre" });
    if (error) throw new Error(`medidas: ${error.message}`);
  }

  // ------------------------------------------------- equivalencias de cocción
  const grupos = new Map();
  for (const i of ingredientes) {
    const n = sinTildes(i.nombre);
    if (FRITO.test(n)) continue;
    if (i.agua_100 === null) continue;
    const estado = CRUDO.test(n) ? "crudo" : COCIDO.test(n) ? "cocido" : null;
    if (!estado) continue;
    const k = claveSinEstado(i.nombre);
    if (!grupos.has(k)) grupos.set(k, { crudo: [], cocido: [] });
    grupos.get(k)[estado].push(i);
  }

  const equivalencias = [];
  const descartados = [];
  for (const [k, v] of grupos) {
    if (!v.crudo.length || !v.cocido.length) continue;
    const mejor = (l) => [...l].sort((a, b) => Number(b.preferente) - Number(a.preferente))[0];
    const cr = mejor(v.crudo);
    const co = mejor(v.cocido);
    const secoCr = 100 - Number(cr.agua_100);
    const secoCo = 100 - Number(co.agua_100);
    if (secoCr <= 0 || secoCo <= 0) continue;
    const factor = secoCr / secoCo;
    const [min, max] = BANDAS[cr.grupo] ?? BANDA_POR_DEFECTO;
    if (factor < min || factor > max) {
      descartados.push({ k, factor, grupo: cr.grupo, min, max });
      continue;
    }
    equivalencias.push({
      ingrediente_crudo_id: cr.id,
      ingrediente_cocido_id: co.id,
      factor: Math.round(factor * 1000) / 1000,
      origen: "materia seca BEDCA",
      agua_crudo: Number(cr.agua_100),
      agua_cocido: Number(co.agua_100),
    });
  }

  console.log(`equivalencias crudo↔cocido: ${equivalencias.length} aceptadas`);
  if (descartados.length) {
    console.log(`   ${descartados.length} descartadas por factor implausible para su grupo:`);
    for (const d of descartados)
      console.log(`     ${d.k.slice(0, 32).padEnd(32)} factor ${d.factor.toFixed(2)} fuera de [${d.min}, ${d.max}] (${d.grupo})`);
  }

  if (equivalencias.length) {
    const { error } = await supabase
      .from("equivalencias_coccion")
      .upsert(equivalencias, { onConflict: "ingrediente_crudo_id,ingrediente_cocido_id" });
    if (error) throw new Error(`equivalencias: ${error.message}`);
  }

  const { count } = await supabase
    .from("medidas_caseras").select("*", { count: "exact", head: true }).is("owner_id", null);
  console.log(`\nHecho. ${count} medidas de serie y ${equivalencias.length} equivalencias.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
