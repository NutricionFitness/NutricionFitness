/**
 * Ver qué trae Open Food Facts para un código de barras, sin tocar la base.
 *
 *   npm run probar-codigo -- 8410179000015 [más códigos...]
 *
 * Va en TypeScript y se ejecuta con `vite-node`, que ya viene con vitest: así
 * usa **el mismo conversor que la app**, no una copia que se quedaría atrás.
 *
 * Existe porque el conversor está probado contra fichas de mentira —66 tests,
 * pero fichas escritas a mano— y lo que hace falta saber es qué devuelve la
 * fuente de verdad para los productos de tu despensa. Coge cuatro envases del
 * armario, pasa sus códigos por aquí y mira si los números cuadran con las
 * etiquetas.
 *
 * No necesita claves ni dependencias, y no escribe nada en ningún sitio.
 */

import { convertir, type ProductoOFF } from "../lib/openfoodfacts/convertir";
import { normalizarEan } from "../lib/openfoodfacts/ean";

const AGENTE = `AppNutricion/1.0 (${
  process.env.OPENFOODFACTS_CONTACTO || "sin-contacto-configurado"
})`;

const CAMPOS = [
  "product_name",
  "product_name_es",
  "generic_name",
  "generic_name_es",
  "brands",
  "quantity",
  "nutrition_data_per",
  "nutriments",
  "allergens_tags",
  "traces_tags",
  "categories_tags",
].join(",");

const codigos = process.argv.slice(2);
if (!codigos.length) {
  console.error("Uso: npm run probar-codigo -- <código> [<código>...]");
  process.exit(1);
}

const n2 = (v: unknown) => (v === null || v === undefined ? "—" : String(v));

for (const bruto of codigos) {
  console.log("\n" + "─".repeat(66));

  const ean = normalizarEan(bruto);
  if (!ean) {
    console.log(`${bruto}  ✗  no es un código válido (longitud o dígito de control)`);
    continue;
  }

  let producto: ProductoOFF | null = null;
  for (const codigo of ean.consultas) {
    const r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${codigo}.json?fields=${CAMPOS}`,
      { headers: { "User-Agent": AGENTE, Accept: "application/json" } },
    );
    if (r.status === 429) {
      console.log("✗  Open Food Facts limita a 15 consultas por minuto. Espera un poco.");
      process.exit(1);
    }
    if (!r.ok) continue;
    const cuerpo = await r.json();
    if (cuerpo.status === 1 && cuerpo.product) {
      producto = cuerpo.product;
      break;
    }
  }

  if (!producto) {
    console.log(`${ean.codigo}  ✗  Open Food Facts no lo conoce`);
    continue;
  }

  const p = convertir(producto, ean.codigo);
  const kcal = 4 * p.prot_100 + 4 * p.hc_100 + 9 * p.grasa_100 + 7 * p.alcohol_100;

  console.log(`${ean.codigo}  ${p.nombre}`);
  console.log(`  grupo ${n2(p.grupo)} · estado ${p.estado}`);
  console.log(
    `  por 100 g: ${p.prot_100} prot · ${p.hc_100} hc · ${p.grasa_100} grasa · ` +
      `${p.fibra_100} fibra · ${n2(p.ags_100)} AGS · ${n2(p.sodio_100)} mg sodio`,
  );
  console.log(
    `  energía: ${Math.round(kcal)} kcal calculadas · ${n2(
      p.kcal_ref === null ? null : Math.round(p.kcal_ref),
    )} declaradas`,
  );
  if (p.alergenos.length) console.log(`  alérgenos: ${p.alergenos.join(", ")}`);
  if (p.trazas.length) console.log(`  trazas: ${p.trazas.join(", ")}`);

  for (const a of p.avisos)
    console.log(`  ${a.gravedad === "alto" ? "‼" : "·"} [${a.clave}] ${a.texto}`);
  if (!p.avisos.length) console.log("  sin avisos");
}

console.log();
