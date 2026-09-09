/**
 * Vuelca en el catálogo compartido los productos de Open Food Facts.
 *
 *     npm run cargar-off -- --seco                    # cuenta y enseña, no escribe
 *     npm run cargar-off -- --fichero C:\\...\\off.csv.gz
 *     npm run cargar-off                              # descarga y carga
 *     npm run cargar-off -- --desde 2026-08-01        # solo lo cambiado desde esa fecha
 *     npm run cargar-off -- --desde ultimo            # desde la última pasada buena
 *
 * Necesita en el entorno (o en .env.local):
 *     NEXT_PUBLIC_SUPABASE_URL
 *     SUPABASE_SERVICE_ROLE_KEY     ← la clave de servicio, NUNCA la del navegador
 *     OPENFOODFACTS_CONTACTO        ← tu correo; su servidor pide identificarse
 *
 * ## Por qué el CSV y no el JSONL
 *
 * La primera versión de este fichero leía el volcado JSONL, con el argumento de
 * que trae la misma forma que la API y así el conversor de la fase 14 valía tal
 * cual. **El argumento era bueno y la premisa era falsa.** Medido sobre el
 * volcado de verdad:
 *
 *     JSONL, productos españoles con macros ......      37 de 358.196  (0,01%)
 *     CSV,   productos españoles con macros ..... 261.192 de 354.697  (73,64%)
 *
 * El JSONL trae `nutriments` vacío. Se comprobó además contra una ficha
 * concreta —una almendra de Hacendado— que la API sí devuelve completa y el
 * JSONL trae sin nutrientes. Y de paso el CSV pesa 1,2 GB contra 5 GB.
 *
 * El conversor sigue sin tocarse: `lib/openfoodfacts/desde-csv.ts` adapta una
 * fila a la forma que `convertir()` espera, y ahí siguen viviendo las trampas de
 * la fuente con sus cuarenta pruebas.
 *
 * ## Lo que NO hace
 *
 * · **No carga bebidas alcohólicas.** El CSV no trae `alcohol_unit` y no se ha
 *   podido deducir si `alcohol_100g` viene en grados o en gramos: la medición
 *   salió contradictoria. Como `kcal_100` es una columna generada que multiplica
 *   el alcohol por 7, equivocarse ahí mete un 27% de energía de más sin que se
 *   vea en ninguna pantalla. El porqué completo está en `desde-csv.ts`.
 *   `--con-alcohol` los incluye, leyéndolos como % vol.
 * · No borra. Un producto que desaparezca de Open Food Facts se queda aquí.
 * · No revisa. Todo entra con `revisado = false` y `alergenos_revisados = false`.
 * · No pisa lo corregido a mano ni nada que no sea del volcado: eso lo garantiza
 *   `cargar_productos_off()` en la base, no este fichero.
 */

import { createClient } from "@supabase/supabase-js";
import { createReadStream, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { convertir, nombreDelProducto } from "../lib/openfoodfacts/convertir";
import {
  esAlcoholico,
  filaAProducto,
  fueraDeRango,
  indiceDeCabecera,
} from "../lib/openfoodfacts/desde-csv";
import { normalizarEan } from "../lib/openfoodfacts/ean";
import { normalizarNombre } from "../app/ingredientes/tipos";

const AQUI = dirname(fileURLToPath(import.meta.url));
const VOLCADO = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";
const LOTE = 500;

/** Avisos que descalifican una ficha para una carga masiva. */
const DESCALIFICAN = new Set(["sin_datos", "todo_cero", "suma_imposible"]);

function argumentos() {
  const a = process.argv.slice(2);
  const val = (n: string) => {
    const i = a.indexOf(n);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    seco: a.includes("--seco"),
    pais: (val("--pais") ?? "en:spain").toLowerCase(),
    todosLosPaises: a.includes("--todos-los-paises"),
    conAlcohol: a.includes("--con-alcohol"),
    fichero: val("--fichero"),
    desde: val("--desde"),
    limite: val("--limite") ? Number(val("--limite")) : Infinity,
  };
}

function cargarEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      const texto = readFileSync(resolve(AQUI, "..", f), "utf8");
      for (const linea of texto.split("\n")) {
        const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      /* el fichero puede no existir */
    }
  }
}

async function* lineas(fichero?: string): AsyncGenerator<string> {
  let entrada: NodeJS.ReadableStream;
  if (fichero) {
    entrada = createReadStream(fichero);
  } else {
    const contacto = process.env.OPENFOODFACTS_CONTACTO;
    const r = await fetch(VOLCADO, {
      headers: { "User-Agent": `app-nutricion/volcado (${contacto ?? "sin contacto"})` },
    });
    if (!r.ok || !r.body) throw new Error(`Open Food Facts contestó ${r.status}`);
    entrada = Readable.fromWeb(r.body as never);
  }
  const rl = createInterface({ input: entrada.pipe(createGunzip()), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) yield l;
}

async function main() {
  cargarEnv();
  const arg = argumentos();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!arg.seco && (!url || !clave)) {
    console.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Están en tu proyecto de Supabase, en Project Settings > API.\n" +
        "Para ver qué haría sin escribir nada: npm run cargar-off -- --seco",
    );
    process.exit(1);
  }
  const supabase = arg.seco ? null : createClient(url!, clave!, { auth: { persistSession: false } });

  /**
   * `--desde ultimo` lee la marca de agua del diario.
   *
   * Es lo que hace que una recarga programada siga siendo correcta aunque se
   * salte un mes: se carga lo cambiado desde la última pasada BUENA, no desde
   * «hace treinta días». Una fecha suelta también vale.
   */
  let desdeT: number | null = null;
  if (arg.desde === "ultimo") {
    if (!supabase) {
      console.error("`--desde ultimo` necesita la base: no se puede usar con --seco.");
      process.exit(1);
    }
    const { data, error } = await supabase
      .from("cargas_off")
      .select("hasta_t")
      .is("error", null)
      .order("hasta_t", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`no se puede leer cargas_off: ${error.message}`);
    desdeT = data?.hasta_t ? Number(data.hasta_t) : null;
    console.log(
      desdeT
        ? `Marca de agua del diario: ${new Date(desdeT * 1000).toISOString().slice(0, 10)}.`
        : "El diario está vacío: esta pasada será completa.",
    );
  } else if (arg.desde) {
    desdeT = Math.floor(new Date(arg.desde).getTime() / 1000);
    if (!Number.isFinite(desdeT)) {
      console.error(`No entiendo la fecha «${arg.desde}». Usa 2026-08-01, o «ultimo».`);
      process.exit(1);
    }
  }

  console.log(arg.fichero ? `Leyendo ${arg.fichero}` : `Descargando ${VOLCADO}`);
  if (arg.seco) console.log("(en seco: no se escribe nada)");
  console.log(
    `Filtro: ${arg.todosLosPaises ? "todos los países" : arg.pais}, con los tres macros` +
      `${desdeT ? `, modificados desde ${arg.desde}` : ""}` +
      `${arg.conAlcohol ? ", INCLUYENDO alcohólicas (leídas como % vol)" : ""}.`,
  );

  const empezado = Date.now();
  let hastaT = 0;
  const cuenta = {
    filas: 0,
    delPais: 0,
    sinMacros: 0,
    alcoholicos: 0,
    sinCodigo: 0,
    descalificados: 0,
    sinNombre: 0,
    sinEnergia: 0,
    fueraDeRango: 0,
    viejos: 0,
    aceptados: 0,
    escritos: 0,
    alergenos: 0,
    rechazadas: 0,
  };
  const porAviso = new Map<string, number>();
  const muestra: string[] = [];
  const rechazadas: string[] = [];

  let idx: ReturnType<typeof indiceDeCabecera> | null = null;
  let lote: Record<string, unknown>[] = [];
  let loteAlergenos: { codigo_barras: string; alergenos: string[] }[] = [];

  /**
   * Manda el lote y, si la base lo rechaza, **aísla la fila culpable**.
   *
   * La primera carga de verdad murió a los 116.000 productos con un `numeric
   * field overflow` y se llevó por delante el resto de la pasada. Una fila mala
   * no puede tumbar un millón de filas buenas: si el lote falla, se reintenta
   * de una en una, se apunta cuál y con qué mensaje, y se sigue. El control de
   * rango de `fueraDeRango` caza el caso conocido antes de llegar aquí; esto es
   * la red para los que no conocemos.
   */
  const mandarLote = async (filas: Record<string, unknown>[]) => {
    const { data, error } = await supabase!.rpc("cargar_productos_off", { p_filas: filas });
    if (!error) return Number(data ?? 0);

    if (filas.length === 1) {
      if (rechazadas.length < 20)
        rechazadas.push(`   ${filas[0].codigo_barras} · ${filas[0].nombre} → ${error.message}`);
      cuenta.rechazadas++;
      return 0;
    }
    let n = 0;
    for (const f of filas) n += await mandarLote([f]);
    return n;
  };

  const vaciar = async () => {
    if (!lote.length) return;
    if (supabase) {
      cuenta.escritos += await mandarLote(lote);

      const conAlergenos = loteAlergenos.filter((a) => a.alergenos.length);
      if (conAlergenos.length) {
        const { data: n, error: e2 } = await supabase.rpc("cargar_alergenos_off", {
          p_filas: conAlergenos,
        });
        // Los alérgenos sí paran la carga: entrar sin ellos es entrar mal, y es
        // lo único de todo esto que puede hacer daño de verdad.
        if (e2) throw new Error(`cargar_alergenos_off: ${e2.message}`);
        cuenta.alergenos += Number(n ?? 0);
      }
    } else {
      cuenta.escritos += lote.length;
    }
    lote = [];
    loteAlergenos = [];
    process.stdout.write(`\r   ${cuenta.aceptados} aceptados de ${cuenta.filas} filas`);
  };

  for await (const linea of lineas(arg.fichero)) {
    // La cabecera manda: las columnas se resuelven por nombre y, si falta alguna
    // de las necesarias, esto revienta diciendo cuál en vez de leer el campo de
    // al lado.
    if (!idx) {
      idx = indiceDeCabecera(linea);
      continue;
    }
    cuenta.filas++;
    if (cuenta.aceptados >= arg.limite) break;

    // Filtro barato antes de partir la línea en 211 campos.
    if (!arg.todosLosPaises && !linea.includes(arg.pais)) continue;

    const campos = linea.split("\t");
    const f = filaAProducto(campos, idx, { incluirAlcohol: arg.conAlcohol });
    if (!f) continue;

    if (!arg.todosLosPaises && !f.paises.includes(arg.pais)) continue;
    cuenta.delPais++;

    if (desdeT !== null && (f.modificado ?? 0) < desdeT) {
      cuenta.viejos++;
      continue;
    }

    const n = f.producto.nutriments ?? {};
    if (n["proteins_100g"] === undefined || n["carbohydrates_100g"] === undefined ||
        n["fat_100g"] === undefined) {
      cuenta.sinMacros++;
      continue;
    }

    if (!arg.conAlcohol && esAlcoholico(campos, idx)) {
      cuenta.alcoholicos++;
      continue;
    }

    // El mismo comprobador que usa el escáner: un dígito de control que no
    // cuadra es un código mal tecleado, y guardarlo haría que el día que
    // escanees ese producto de verdad encuentres otro.
    const ean = normalizarEan(f.codigo);
    if (!ean) {
      cuenta.sinCodigo++;
      continue;
    }

    const prop = convertir(f.producto, ean.codigo);
    for (const a of prop.avisos) porAviso.set(a.clave, (porAviso.get(a.clave) ?? 0) + 1);

    if (prop.avisos.some((a) => DESCALIFICAN.has(a.clave))) {
      cuenta.descalificados++;
      continue;
    }
    if (!nombreDelProducto(f.producto).trim()) {
      cuenta.sinNombre++;
      continue;
    }
    // `kcal_100` es generada por Atwater. Un producto a cero no se puede
    // sustituir ni entra en el comparador: sería una fila muerta.
    const kcal = 4 * prop.prot_100 + 4 * prop.hc_100 + 9 * prop.grasa_100 + 7 * prop.alcohol_100;
    if (!(kcal > 0)) {
      cuenta.sinEnergia++;
      continue;
    }

    // Que quepa en las columnas. Los topes son físicos —más de 100 g de algo en
    // 100 g de producto no puede ser— y por eso separan un dato de una errata.
    const mal = fueraDeRango(prop);
    if (mal) {
      cuenta.fueraDeRango++;
      if (rechazadas.length < 20) rechazadas.push(`   ${prop.codigo_barras} · ${prop.nombre} → ${mal}`);
      continue;
    }

    cuenta.aceptados++;
    // La marca de agua sale de lo que ENTRA, no de lo que se lee: así una
    // pasada que descarte mucho no adelanta el reloj más de la cuenta.
    if (f.modificado && f.modificado > hastaT) hastaT = f.modificado;
    if (muestra.length < 5)
      muestra.push(
        `   ${prop.nombre} — ${Math.round(kcal)} kcal/100 g · ` +
          `P ${prop.prot_100} HC ${prop.hc_100} G ${prop.grasa_100}` +
          (prop.alergenos.length ? ` · alérgenos: ${prop.alergenos.join(", ")}` : ""),
      );

    lote.push({
      codigo_barras: prop.codigo_barras,
      nombre: prop.nombre,
      nombre_norm: normalizarNombre(prop.nombre),
      grupo: prop.grupo,
      estado: prop.estado,
      prot_100: prop.prot_100,
      hc_100: prop.hc_100,
      grasa_100: prop.grasa_100,
      fibra_100: prop.fibra_100,
      alcohol_100: prop.alcohol_100,
      ags_100: prop.ags_100,
      agua_100: prop.agua_100,
      sodio_100: prop.sodio_100,
      kcal_ref: prop.kcal_ref,
      porcion_comestible: prop.porcion_comestible,
      notas: prop.notas,
    });
    // Trazas y contenido se marcan igual: decisión de `alergias.md`.
    loteAlergenos.push({
      codigo_barras: prop.codigo_barras,
      alergenos: [...new Set([...prop.alergenos, ...prop.trazas])],
    });

    if (lote.length >= LOTE) await vaciar();
  }
  await vaciar();

  const n = (x: number) => x.toLocaleString("es-ES");
  console.log("\n");
  console.log(`Filas                ${n(cuenta.filas)}`);
  console.log(`Del país             ${n(cuenta.delPais)}`);
  if (desdeT !== null) console.log(`  sin cambios        ${n(cuenta.viejos)}`);
  console.log(`  sin los tres macros ${n(cuenta.sinMacros)}`);
  console.log(`  con alcohol        ${n(cuenta.alcoholicos)}${arg.conAlcohol ? "" : "  (fuera a propósito)"}`);
  console.log(`  código no válido   ${n(cuenta.sinCodigo)}`);
  console.log(`  ficha imposible    ${n(cuenta.descalificados)}`);
  console.log(`  sin nombre         ${n(cuenta.sinNombre)}`);
  console.log(`  sin energía        ${n(cuenta.sinEnergia)}`);
  console.log(`  fuera de rango     ${n(cuenta.fueraDeRango)}`);
  console.log(`ACEPTADOS            ${n(cuenta.aceptados)}`);
  if (!arg.seco) {
    console.log(`Escritos             ${n(cuenta.escritos)}`);
    console.log(`Alérgenos marcados   ${n(cuenta.alergenos)}`);
    if (cuenta.rechazadas)
      console.log(`Rechazadas por la base ${n(cuenta.rechazadas)}`);
  }

  if (rechazadas.length) {
    console.log("\nFilas que se han caído, con el motivo:");
    for (const r of rechazadas) console.log(r);
  }

  console.log("\nAvisos del conversor (los mismos que verías al escanear uno a uno):");
  for (const [clave, v] of [...porAviso].sort((a, b) => b[1] - a[1]))
    console.log(`   ${clave.padEnd(26)} ${n(v)}`);
  console.log(
    "\n   Nota: `por_racion` no puede salir nunca en el volcado. El CSV no trae\n" +
      "   `nutrition_data_per`, así que no hay forma de saber si los valores los\n" +
      "   dedujo Open Food Facts de una ración. Escaneando de uno en uno sí se ve.",
  );

  if (muestra.length) {
    console.log("\nLos primeros que han entrado:");
    for (const m of muestra) console.log(m);
  }

  // ------------------------------------------------------------ el diario --
  // Una fila por pasada. Sin esto, un refresco que lleva cuatro meses sin
  // ejecutarse se parece mucho a uno que funciona (migración 0019).
  if (!arg.seco && supabase) {
    const { error } = await supabase.from("cargas_off").insert({
      origen: desdeT ? "csv-incremental" : "csv",
      desde_t: desdeT,
      hasta_t: hastaT || null,
      filas: cuenta.filas,
      del_pais: cuenta.delPais,
      sin_macros: cuenta.sinMacros,
      alcoholicos: cuenta.alcoholicos,
      sin_codigo: cuenta.sinCodigo,
      descalificados: cuenta.descalificados,
      sin_nombre: cuenta.sinNombre,
      sin_energia: cuenta.sinEnergia,
      fuera_de_rango: cuenta.fueraDeRango,
      aceptados: cuenta.aceptados,
      escritos: cuenta.escritos,
      alergenos: cuenta.alergenos,
      rechazadas: cuenta.rechazadas,
      segundos: Math.round((Date.now() - empezado) / 1000),
    });
    // Que falle el diario no invalida la carga, pero hay que decirlo: a partir
    // de ahí, `--desde ultimo` no sabría por dónde iba.
    if (error) console.error(`\nAVISO: la carga fue bien pero no se ha podido escribir en cargas_off: ${error.message}`);
  }

  if (!arg.seco && supabase) {
    const { count } = await supabase
      .from("ingredientes")
      .select("*", { count: "exact", head: true })
      .eq("fuente", "openfoodfacts");
    console.log(`\nEl catálogo tiene ahora ${n(count ?? 0)} productos de Open Food Facts.`);
    console.log("Open Food Facts, licencia ODbL. Publicarlos —el comparador lo hace— obliga a atribuir.");
  }
}

main().catch((e) => {
  console.error("\n", e);
  process.exit(1);
});
