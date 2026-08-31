#!/usr/bin/env node
/**
 * Carga el catálogo de ingredientes de la fase 1 en Supabase.
 *
 *     node scripts/cargar-ingredientes.mjs
 *
 * Necesita en el entorno (o en .env.local):
 *     NEXT_PUBLIC_SUPABASE_URL
 *     SUPABASE_SERVICE_ROLE_KEY     ← la clave de servicio, NUNCA la del navegador
 *
 * Es idempotente: la carga la hace `cargar_catalogo_bedca()` en la base, con un
 * `on conflict (owner_id, codigo_bedca) where codigo_bedca is not null`, así que
 * se puede relanzar sin duplicar nada. Los ingredientes del catálogo van con
 * owner_id NULL: los ve cualquiera que haya iniciado sesión.
 *
 * Antes esto era un `upsert` de PostgREST. Dejó de poder serlo en la 0016: el
 * índice único pasó a ser **parcial** —sin eso, una cuenta solo podía tener un
 * ingrediente propio, porque los propios no llevan código de BEDCA y dos nulos
 * chocaban— y PostgreSQL no puede inferir un índice parcial en un `on conflict`
 * que no lleve su `where`, que PostgREST no deja escribir.
 *
 * Desde la migración 0006 el catálogo compartido SÍ se puede corregir desde la
 * app. Los ingredientes marcados con `editado_a_mano` se saltan en la carga,
 * para que relanzarla no borre esas correcciones.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATOS = resolve(AQUI, "../supabase/datos/ingredientes.json.gz");
const LOTE = 500;

function cargarEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      const texto = readFileSync(resolve(AQUI, "..", f), "utf8");
      for (const linea of texto.split("\n")) {
        const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* el fichero puede no existir */ }
  }
}

async function main() {
  cargarEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    console.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Están en tu proyecto de Supabase, en Project Settings > API.",
    );
    process.exit(1);
  }

  const paquete = JSON.parse(gunzipSync(readFileSync(DATOS)).toString("utf8"));
  const supabase = createClient(url, clave, { auth: { persistSession: false } });

  // Lo que se ha corregido a mano desde la app no se toca. Esta carga usa la
  // clave de servicio y se salta el RLS, así que si no se filtrara aquí, una
  // recarga devolvería cada corrección a su valor original de BEDCA sin decir
  // nada. La fuente manda, pero una corrección posterior es más reciente que la
  // fuente.
  const { data: tocados, error: errorTocados } = await supabase
    .from("ingredientes")
    .select("codigo_bedca")
    .is("owner_id", null)
    .eq("editado_a_mano", true);
  if (errorTocados) throw new Error(`no se han podido leer las correcciones: ${errorTocados.message}`);
  const protegidos = new Set((tocados ?? []).map((t) => t.codigo_bedca));

  const todas = paquete.ingredientes.map((i) => ({ ...i, owner_id: null }));
  const filas = todas.filter((i) => !protegidos.has(i.codigo_bedca));

  console.log(`${todas.length} ingredientes en el paquete (fuente: ${paquete.fuente})`);
  if (protegidos.size)
    console.log(`   ${protegidos.size} se respetan por estar corregidos a mano`);
  console.log(`${filas.length} a cargar`);

  let hechos = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const { error } = await supabase.rpc("cargar_catalogo_bedca", { p_filas: lote });
    if (error) {
      console.error(`\nError en el lote que empieza en ${i}:`, error.message);
      process.exit(1);
    }
    hechos += lote.length;
    process.stdout.write(`\r   ${hechos}/${filas.length}`);
  }

  const { count, error } = await supabase
    .from("ingredientes")
    .select("*", { count: "exact", head: true })
    .is("owner_id", null);
  if (error) throw error;
  console.log(`\nHecho. El catálogo compartido tiene ${count} ingredientes.`);

  // Un par de comprobaciones para no dar por buena una carga a medias.
  const { data: muestra } = await supabase
    .from("ingredientes")
    .select("nombre, kcal_100, prot_100, hc_100, grasa_100")
    .eq("codigo_bedca", "746")
    .is("owner_id", null)
    .single();
  if (muestra) {
    const esperado = 4 * muestra.prot_100 + 4 * muestra.hc_100 + 9 * muestra.grasa_100;
    const ok = Math.abs(muestra.kcal_100 - esperado) < 0.01;
    console.log(
      `   comprobación: ${muestra.nombre} = ${muestra.kcal_100} kcal/100 g ` +
        `${ok ? "✓ (la calcula la base)" : "✗ NO CUADRA"}`,
    );
    if (!ok) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
