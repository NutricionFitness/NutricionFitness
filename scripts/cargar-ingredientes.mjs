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
 * Es idempotente: se apoya en la restricción única (owner_id, codigo_bedca) con
 * NULLS NOT DISTINCT, así que se puede relanzar sin duplicar nada. Los
 * ingredientes del catálogo van con owner_id NULL: los ve cualquiera que haya
 * iniciado sesión, pero nadie puede modificarlos.
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
  const filas = paquete.ingredientes.map((i) => ({ ...i, owner_id: null }));
  console.log(`${filas.length} ingredientes a cargar (fuente: ${paquete.fuente})`);

  const supabase = createClient(url, clave, { auth: { persistSession: false } });

  let hechos = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const { error } = await supabase
      .from("ingredientes")
      .upsert(lote, { onConflict: "owner_id,codigo_bedca", ignoreDuplicates: false });
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
