/**
 * Diagnóstico: ¿trae el volcado la tabla nutricional, o no?
 *
 *     npm run mirar-off -- --fichero C:\\...\\off.jsonl.gz --saltar 3000000
 *     npm run mirar-off -- --fichero C:\\...\\off.jsonl.gz --codigo 8480000123456
 *
 * Historia: la carga real dio 358.196 productos españoles y 37 con macros. La
 * primera pasada de esto enseñó que `nutriments` viene **vacío**; la segunda,
 * que los únicos números que se parecen a un macro están en `nutriscore.…data`,
 * que no sirve —no lleva grasa total ni hidratos—.
 *
 * Queda una duda razonable: que la muestra estuviera sesgada. Así que ahora se
 * cuenta **sobre todas las líneas leídas**, no sobre las de un país, y se
 * comparan tres cosas:
 *
 *   · cuántas fichas del mundo traen `proteins_100g` en el texto crudo,
 *   · cuántas del país,
 *   · y, de las que sí lo traen, cómo son por dentro.
 *
 * Si el porcentaje mundial también es ridículo, el volcado no sirve y hay que
 * ir al CSV. Si el mundial es alto y el español no, el sesgo está en otro sitio
 * y hay que buscarlo ahí.
 *
 * `--codigo` busca productos concretos: los que hayas escaneado tú y sepas que
 * la API contesta bien. Es la comprobación que zanja la discusión, porque
 * compara la misma ficha en las dos fuentes.
 *
 * No escribe nada.
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const VOLCADO = "https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FICHERO = arg("--fichero");
const PAIS = (arg("--pais") ?? "en:spain").toLowerCase();
const SALTAR = Number(arg("--saltar") ?? 0);
const LINEAS = Number(arg("--lineas") ?? 300_000);
const CODIGOS = new Set((arg("--codigo") ?? "").split(",").map((c) => c.trim()).filter(Boolean));

/**
 * El CSV es el plan B, y se mira con el mismo comando.
 *
 * Es tabulado y sin comillas —Open Food Facts quita los tabuladores y saltos de
 * línea de los campos antes de exportar—, así que partir por `\t` es correcto.
 * Las columnas se resuelven por su NOMBRE leído de la cabecera, no por posición:
 * si un día añaden una columna en medio, esto sigue valiendo o falla diciéndolo,
 * en vez de leer el campo de al lado.
 */
const ES_CSV = /\.csv(\.gz)?$/i.test(FICHERO ?? "");

async function* lineas(): AsyncGenerator<string> {
  let entrada: NodeJS.ReadableStream;
  if (FICHERO) {
    entrada = createReadStream(FICHERO);
  } else {
    const r = await fetch(VOLCADO, { headers: { "User-Agent": "app-nutricion/diagnostico" } });
    if (!r.ok || !r.body) throw new Error(`Open Food Facts contestó ${r.status}`);
    entrada = Readable.fromWeb(r.body as never);
  }
  const rl = createInterface({ input: entrada.pipe(createGunzip()), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) yield l;
}

const pct = (n: number, de: number) => (de ? `${((100 * n) / de).toFixed(2)}%` : "—");

async function csv() {
  const NECESARIAS = ["code", "countries_tags", "proteins_100g", "carbohydrates_100g", "fat_100g"];
  let cabecera: string[] | null = null;
  let idx: Record<string, number> = {};
  let filas = 0, delPais = 0, conMacros = 0, sinTabla = 0, conRacion = 0;
  const ejemplos: string[] = [];
  const alergenos: string[] = [];
  // Por tramos de alcohol. Con 0,16 g/100 g las dos lecturas dan lo mismo, así
  // que meterlos en la misma mediana que un vino tapa la señal: la primera
  // versión de esta medida dio 2,3% contra 2,3% y no distinguía nada.
  const TRAMOS = [0, 2, 5, 10] as const;
  const desvGrados: number[][] = TRAMOS.map(() => []);
  const desvGramos: number[][] = TRAMOS.map(() => []);
  const ejemplosAlc: string[] = [];

  for await (const linea of lineas()) {
    if (!cabecera) {
      cabecera = linea.split("\t");
      idx = Object.fromEntries(cabecera.map((c, i) => [c, i]));
      const faltan = NECESARIAS.filter((c) => idx[c] === undefined);
      if (faltan.length) {
        console.error(`La cabecera del CSV no trae: ${faltan.join(", ")}`);
        console.error(`Columnas encontradas (${cabecera.length}): ${cabecera.slice(0, 40).join(", ")}…`);
        process.exit(1);
      }
      console.log(`Cabecera con ${cabecera.length} columnas. Las cinco que hacen falta están.\n`);

      // `--cabecera` sale aquí mismo: solo hay que leer la primera línea, y es
      // lo que hace falta para escribir el mapeo de columnas contra los nombres
      // de verdad en vez de contra los que uno se imagina.
      if (process.argv.includes("--cabecera")) {
        const interesantes = cabecera.filter((c) =>
          /allerg|trace|categor|countr|nutriment|_100g|_unit|serving|quantity|brand|product_name|generic|last_modified|^code$|nutrition_data/i.test(c),
        );
        console.log(`--- Columnas que pueden importar (${interesantes.length}):`);
        console.log(interesantes.join("\n"));
        console.log(`\n--- TODAS (${cabecera.length}):`);
        console.log(cabecera.join(", "));
        return;
      }
      continue;
    }
    filas++;
    const c = linea.split("\t");
    const paises = (c[idx["countries_tags"]] ?? "").toLowerCase();
    if (!paises.split(",").includes(PAIS)) continue;
    delPais++;
    const p = c[idx["proteins_100g"]], h = c[idx["carbohydrates_100g"]], g = c[idx["fat_100g"]];
    if (p && h && g) {
      conMacros++;
      if (ejemplos.length < 5)
        ejemplos.push(`   ${c[idx["code"]]}  P ${p}  HC ${h}  G ${g}  — ${c[idx["product_name"]] ?? ""}`);
    }

    if ((c[idx["no_nutrition_data"]] ?? "").trim()) sinTabla++;
    if ((c[idx["serving_size"]] ?? "").trim()) conRacion++;

    // Cómo vienen escritos los alérgenos: es lo que decide el mapeo, y aquí no
    // se supone nada. Se mira lo que hay.
    const al = (c[idx["allergens"]] ?? "").trim();
    if (al && alergenos.length < 12) {
      alergenos.push(
        `   allergens="${al.slice(0, 90)}"\n` +
        `   allergens_en="${(c[idx["allergens_en"]] ?? "").slice(0, 90)}"\n` +
        `   traces="${(c[idx["traces"]] ?? "").slice(0, 60)}"  ` +
        `traces_tags="${(c[idx["traces_tags"]] ?? "").slice(0, 60)}"  ` +
        `traces_en="${(c[idx["traces_en"]] ?? "").slice(0, 60)}"`,
      );
    }

    // El alcohol, medido.
    const alc = Number(c[idx["alcohol_100g"]]);
    const kcalDecl = Number(c[idx["energy-kcal_100g"]]);
    if (alc > 0 && kcalDecl > 0 && p && h && g) {
      const base = 4 * Number(p) + 4 * Number(h) + 9 * Number(g);
      const comoGrados = base + 7 * alc * 0.789;
      const comoGramos = base + 7 * alc;
      if (comoGrados > 0 && comoGramos > 0) {
        TRAMOS.forEach((min, i) => {
          if (alc >= min) {
            desvGrados[i].push(Math.abs(kcalDecl / comoGrados - 1));
            desvGramos[i].push(Math.abs(kcalDecl / comoGramos - 1));
          }
        });
        // Los ejemplos, solo de los que de verdad distinguen.
        if (alc >= 10 && ejemplosAlc.length < 8)
          ejemplosAlc.push(
            `   ${c[idx["code"]]} alcohol_100g=${alc} · declara ${kcalDecl} kcal · ` +
            `%vol→${comoGrados.toFixed(0)} · gramos→${comoGramos.toFixed(0)}` +
            ` — ${(c[idx["product_name"]] ?? "").slice(0, 40)}`,
          );
      }
    }
  }

  // ---------------------------------------------------------------------
  // El alcohol: la trampa más cara de la fase 14.
  //
  // El CSV **no trae `alcohol_unit`**, así que hay que averiguar por los datos
  // si `alcohol_100g` viene en % vol o en gramos. Se compara la energía
  // declarada contra la calculada con Atwater de las dos maneras y gana la que
  // se acerque. Con un vino de 12, la diferencia entre las dos lecturas es un
  // 27% de la energía, y como `kcal_100` es columna generada, equivocarse aquí
  // no se vería en ninguna pantalla.
  // ---------------------------------------------------------------------
  const mediana = (v: number[]) =>
    v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : NaN;

  console.log(`Filas            ${filas.toLocaleString("es-ES")}`);
  console.log(`De ${PAIS}       ${delPais.toLocaleString("es-ES")}`);
  console.log(`  con los tres macros  ${conMacros.toLocaleString("es-ES")}  (${pct(conMacros, delPais)})\n`);
  console.log(`  marcadas «sin tabla»   ${sinTabla.toLocaleString("es-ES")}`);
  console.log(`  con serving_size       ${conRacion.toLocaleString("es-ES")}\n`);

  if (ejemplos.length) {
    console.log("Ejemplos con macros:");
    for (const e of ejemplos) console.log(e);
  }

  console.log("\n--- CÓMO VIENEN LOS ALÉRGENOS (decide el mapeo)");
  for (const a of alergenos) console.log(a + "\n");

  console.log("--- EL ALCOHOL: ¿% vol o gramos? (por tramos)");
  console.log("   alcohol_100g ≥   n      %vol    gramos    gana");
  TRAMOS.forEach((min, i) => {
    const n = desvGrados[i].length;
    if (!n) { console.log(`   ${String(min).padStart(10)}   ${String(n).padStart(6)}   —`); return; }
    const a = mediana(desvGrados[i]), b = mediana(desvGramos[i]);
    const gana = Math.abs(a - b) < 0.005 ? "empate" : a < b ? "% VOL" : "GRAMOS";
    console.log(
      `   ${String(min).padStart(10)}   ${String(n).padStart(6)}   ` +
      `${(100 * a).toFixed(1).padStart(5)}%   ${(100 * b).toFixed(1).padStart(5)}%    ${gana}`,
    );
  });
  console.log("\n   El tramo que decide es el de ≥10: ahí las dos lecturas se separan.\n");
  for (const e of ejemplosAlc) console.log(e);
}

async function main() {
  console.log(FICHERO ? `Leyendo ${FICHERO}` : `Descargando ${VOLCADO}`);
  if (ES_CSV) {
    console.log(`Modo CSV. País: ${PAIS}. Recorre el fichero entero.\n`);
    return csv();
  }
  if (CODIGOS.size) {
    console.log(`Buscando ${CODIGOS.size} código(s) concreto(s). Recorre el fichero entero.\n`);
  } else {
    console.log(
      `Contando sobre ${LINEAS.toLocaleString("es-ES")} líneas` +
        `${SALTAR ? `, tras saltar ${SALTAR.toLocaleString("es-ES")}` : ""}. País: ${PAIS}.\n`,
    );
  }

  let leidas = 0, miradas = 0;
  let conProteins100 = 0, conNutrimentsAlgo = 0;
  let delPais = 0, delPaisConProteins100 = 0;
  let sinTablaDeclarada = 0;
  const ejemplos: Record<string, unknown>[] = [];
  const encontrados: Record<string, unknown>[] = [];

  for await (const linea of lineas()) {
    leidas++;

    if (CODIGOS.size) {
      // Barato: mirar el texto antes de parsear.
      let interesa = false;
      for (const c of CODIGOS) if (linea.includes(`"${c}"`)) { interesa = true; break; }
      if (!interesa) continue;
      const p = JSON.parse(linea) as Record<string, unknown>;
      if (!CODIGOS.has(String(p["code"]))) continue;
      encontrados.push(p);
      if (encontrados.length >= CODIGOS.size) break;
      continue;
    }

    if (leidas <= SALTAR) continue;
    miradas++;
    if (miradas > LINEAS) break;

    // El texto crudo: la clave que el cargador necesita, tal cual.
    const tiene = linea.includes('"proteins_100g"');
    if (tiene) conProteins100++;
    if (linea.includes('"no_nutrition_data":"on"')) sinTablaDeclarada++;

    const esDelPais = linea.includes(`"${PAIS}"`);
    if (esDelPais || tiene) {
      let p: Record<string, unknown>;
      try { p = JSON.parse(linea); } catch { continue; }

      const tags = p["countries_tags"];
      const deVerdad = Array.isArray(tags) && tags.some((t) => String(t).toLowerCase() === PAIS);
      if (deVerdad) {
        delPais++;
        if (tiene) delPaisConProteins100++;
      }
      const n = p["nutriments"];
      if (n && typeof n === "object" && Object.keys(n as object).length > 0) {
        conNutrimentsAlgo++;
        if (tiene && ejemplos.length < 3) ejemplos.push(p);
      }
    }
  }

  if (CODIGOS.size) {
    for (const c of CODIGOS) {
      const p = encontrados.find((x) => String(x["code"]) === c);
      if (!p) { console.log(`### ${c} — NO está en el volcado`); continue; }
      console.log(`### ${c} — ${p["product_name"] ?? "(sin nombre)"}`);
      console.log(`   countries_tags     ${JSON.stringify(p["countries_tags"])}`);
      console.log(`   no_nutrition_data  ${JSON.stringify(p["no_nutrition_data"])}`);
      console.log(`   nutrition_data_per ${JSON.stringify(p["nutrition_data_per"])}`);
      console.log(`   nutriments         ${JSON.stringify(p["nutriments"])?.slice(0, 1200)}`);
      console.log(`   last_modified_t    ${p["last_modified_t"]}\n`);
    }
    return;
  }

  console.log(`Líneas leídas      ${leidas.toLocaleString("es-ES")}`);
  console.log(`Líneas contadas    ${(miradas - 1).toLocaleString("es-ES")}\n`);

  console.log("--- EN TODO EL MUNDO (sobre las líneas contadas)");
  console.log(`   con "proteins_100g"      ${conProteins100.toLocaleString("es-ES")}  (${pct(conProteins100, miradas - 1)})`);
  console.log(`   con nutriments no vacío  ${conNutrimentsAlgo.toLocaleString("es-ES")}`);
  console.log(`   marcadas «sin tabla»     ${sinTablaDeclarada.toLocaleString("es-ES")}\n`);

  console.log(`--- SOLO ${PAIS}`);
  console.log(`   fichas                   ${delPais.toLocaleString("es-ES")}`);
  console.log(`   con "proteins_100g"      ${delPaisConProteins100.toLocaleString("es-ES")}  (${pct(delPaisConProteins100, delPais)})\n`);

  if (ejemplos.length) {
    console.log("--- Fichas que SÍ traen la tabla, para ver cómo son");
    for (const p of ejemplos) {
      console.log(`\n### ${p["code"]} — ${p["product_name"] ?? "(sin nombre)"}`);
      console.log(`   países: ${JSON.stringify(p["countries_tags"])?.slice(0, 200)}`);
      console.log(`   nutriments: ${JSON.stringify(p["nutriments"])?.slice(0, 900)}`);
    }
  } else {
    console.log("--- NINGUNA de las líneas contadas trae `proteins_100g`.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
