#!/usr/bin/env node
/**
 * Deduce los alérgenos del catálogo compartido y los carga en Supabase.
 *
 *     node scripts/derivar-alergenos.mjs            ← escribe
 *     node scripts/derivar-alergenos.mjs --ensayo   ← solo enseña el informe
 *
 * Necesita en el entorno (o en .env.local):
 *     NEXT_PUBLIC_SUPABASE_URL
 *     SUPABASE_SERVICE_ROLE_KEY     ← la clave de servicio, NUNCA la del navegador
 *
 * De dónde salen los alérgenos y qué NO garantizan: está explicado arriba del
 * todo en `alergenos-tabla.mjs`. En corto: fuente LanguaL más nombre, curado a
 * mano, y todo lo que escribe va con `origen = 'derivado'`.
 *
 * Es idempotente y **no pisa lo que se haya puesto a mano**: solo borra e
 * inserta filas con `origen = 'derivado'`, y deja en paz las `'manual'` y la
 * marca `alergenos_revisados`.
 */

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { derivarAlergenos, ALERGENOS_ESTANDAR } from "./alergenos-tabla.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATOS = resolve(AQUI, "../supabase/datos/ingredientes.json.gz");
const LOTE = 500;
const ENSAYO = process.argv.includes("--ensayo");

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

  const paquete = JSON.parse(gunzipSync(readFileSync(DATOS)).toString("utf8"));
  const ingredientes = paquete.ingredientes;

  // --- el informe se hace siempre, con base de datos o sin ella -------------
  const derivados = new Map(); // codigo_bedca -> string[]
  const cuenta = {};
  for (const i of ingredientes) {
    const al = derivarAlergenos(i);
    if (al.length) derivados.set(i.codigo_bedca, al);
    for (const a of al) cuenta[a] = (cuenta[a] ?? 0) + 1;
  }

  console.log(
    `${ingredientes.length} ingredientes leídos, ${derivados.size} con al menos un alérgeno\n`,
  );
  for (const { codigo, nombre } of ALERGENOS_ESTANDAR)
    console.log(`   ${nombre.padEnd(30)} ${String(cuenta[codigo] ?? 0).padStart(5)}`);
  console.log(
    "\nEsto es una deducción, no una comprobación. Cada ingrediente queda sin\n" +
      "revisar hasta que alguien confirme su lista en la ficha.",
  );

  if (ENSAYO) {
    console.log("\n--ensayo: no se ha escrito nada.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) {
    console.error(
      "\nFaltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Están en tu proyecto de Supabase, en Project Settings > API.\n" +
        "Con --ensayo puedes ver el informe sin ellas.",
    );
    process.exit(1);
  }

  // Se carga aquí y no arriba para que `--ensayo` funcione sin haber instalado
  // nada: el informe se puede mirar en cualquier sitio.
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, clave, { auth: { persistSession: false } });

  // --- los identificadores que hacen falta ---------------------------------
  const { data: catalogo, error: errAl } = await supabase
    .from("alergenos")
    .select("id, codigo")
    .is("owner_id", null);
  if (errAl) throw new Error(`alérgenos: ${errAl.message}`);
  if (!catalogo?.length)
    throw new Error("El catálogo de alérgenos está vacío: falta aplicar la migración 0007.");
  const idAlergeno = new Map(catalogo.map((a) => [a.codigo, a.id]));

  const { data: filas, error: errIng } = await supabase
    .from("ingredientes")
    .select("id, codigo_bedca")
    .is("owner_id", null)
    .limit(5000);
  if (errIng) throw new Error(`ingredientes: ${errIng.message}`);
  const idIngrediente = new Map(filas.map((f) => [f.codigo_bedca, f.id]));
  console.log(`\n${idIngrediente.size} ingredientes del catálogo compartido en la base`);

  // --- fuera lo derivado de antes, que lo manual se queda ------------------
  const { error: errBorrar } = await supabase
    .from("ingrediente_alergenos")
    .delete()
    .eq("origen", "derivado");
  if (errBorrar) throw new Error(`limpiando lo derivado: ${errBorrar.message}`);

  // --- y dentro lo de ahora ------------------------------------------------
  const nuevas = [];
  let sinPareja = 0;
  for (const [codigoBedca, alergenos] of derivados) {
    const ingredienteId = idIngrediente.get(codigoBedca);
    if (!ingredienteId) {
      sinPareja++;
      continue;
    }
    for (const a of alergenos) {
      const alergenoId = idAlergeno.get(a);
      if (alergenoId)
        nuevas.push({ ingrediente_id: ingredienteId, alergeno_id: alergenoId, origen: "derivado" });
    }
  }
  if (sinPareja)
    console.log(`   ${sinPareja} del paquete no están en la base (no pasa nada: se saltan)`);

  let hechas = 0;
  for (let i = 0; i < nuevas.length; i += LOTE) {
    const lote = nuevas.slice(i, i + LOTE);
    // `ignoreDuplicates` para no chocar con una fila manual del mismo par: si
    // alguien ya lo marcó a mano, su marca manda.
    const { error } = await supabase
      .from("ingrediente_alergenos")
      .upsert(lote, { onConflict: "ingrediente_id,alergeno_id", ignoreDuplicates: true });
    if (error) throw new Error(`insertando: ${error.message}`);
    hechas += lote.length;
    process.stdout.write(`\r   ${hechas}/${nuevas.length}`);
  }

  const { count } = await supabase
    .from("ingrediente_alergenos")
    .select("*", { count: "exact", head: true });
  console.log(`\nHecho. ${count} marcas de alérgeno en total.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
