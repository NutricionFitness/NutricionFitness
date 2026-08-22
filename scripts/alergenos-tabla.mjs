/**
 * De qué está hecho un ingrediente, en términos de alérgenos.
 *
 * BEDCA **no trae alérgenos**. Lo que sí trae, en los 2.157 ingredientes, son
 * códigos LanguaL, y todos menos siete tienen exactamente un código de la faceta
 * B, que es «fuente alimentaria»: 290 fuentes distintas. B1312 es trigo, B1452
 * soja, B1272 almendra, B1337 cacahuete. Esa es la señal buena, y es la que no
 * se puede sacar del nombre: «Cremoso San Millán» no dice en ninguna parte que
 * sea queso, pero su código de fuente sí.
 *
 * La segunda señal es el nombre en castellano, y hace falta porque la fuente
 * solo nombra el ingrediente PRINCIPAL. «Croquetas de pollo» tiene B1457
 * —pollo— y lleva leche, trigo y huevo. Lo mismo la bechamel, la mayonesa o un
 * bocadillo.
 *
 * Ninguna de las dos señales basta sola, y las dos juntas tampoco garantizan
 * nada: **esto es una ayuda para no despistarse, no una comprobación de
 * seguridad alimentaria**. Todo lo que sale de aquí se guarda con
 * `origen = 'derivado'` y el ingrediente queda con `alergenos_revisados = false`
 * hasta que una persona lo confirme.
 *
 * La tabla está curada a mano sobre lo que propuso el cruce automático, porque
 * el automático propone cosas como estas:
 *   · «tapioca» contiene «apio»
 *   · «romero» contiene «mero»
 *   · «cabracho» contiene «cabra»
 *   · la castaña y el piñón NO están en la lista cerrada del Anexo II
 * Cada exclusión de abajo está por una de esas.
 *
 * Norma: Anexo II del Reglamento (UE) 1169/2011, los catorce de declaración
 * obligatoria. Lo que no esté ahí —fructosa, piñón, castaña— se declara como
 * alérgeno propio desde la app y se asigna a mano.
 */

/** Los catorce del Anexo II. `codigo` es lo que viaja a la base. */
export const ALERGENOS_ESTANDAR = [
  { codigo: "gluten", nombre: "Cereales con gluten", detalle: "Trigo, centeno, cebada, avena, espelta, kamut" },
  { codigo: "crustaceos", nombre: "Crustáceos", detalle: "Gamba, langostino, cangrejo, bogavante, cigala…" },
  { codigo: "huevos", nombre: "Huevos", detalle: "Y todo lo que los lleva: mayonesa, tortilla, rebozados" },
  { codigo: "pescado", nombre: "Pescado", detalle: "Incluidos surimi, huevas y aceite de hígado" },
  { codigo: "cacahuetes", nombre: "Cacahuetes", detalle: "Y su aceite" },
  { codigo: "soja", nombre: "Soja", detalle: "Tofu, tempeh, miso, lecitina, salsa de soja" },
  { codigo: "leche", nombre: "Leche", detalle: "Incluida la lactosa: queso, yogur, nata, mantequilla" },
  { codigo: "frutos_cascara", nombre: "Frutos de cáscara", detalle: "Almendra, avellana, nuez, anacardo, pistacho, pecana, macadamia y nuez de Brasil. La castaña y el piñón no están en la lista" },
  { codigo: "apio", nombre: "Apio", detalle: "Incluido el apionabo" },
  { codigo: "mostaza", nombre: "Mostaza", detalle: "" },
  { codigo: "sesamo", nombre: "Granos de sésamo", detalle: "Tahini, gomasio, aceite de sésamo" },
  { codigo: "sulfitos", nombre: "Dióxido de azufre y sulfitos", detalle: "Por encima de 10 mg/kg: vino, vinagre, fruta desecada" },
  { codigo: "altramuces", nombre: "Altramuces", detalle: "" },
  { codigo: "moluscos", nombre: "Moluscos", detalle: "Mejillón, almeja, calamar, pulpo, caracol…" },
];

/**
 * Fuente LanguaL → alérgeno, cuando la fuente basta por sí sola.
 *
 * No están aquí las fuentes de mamífero ni de ave: que algo venga de una vaca no
 * dice si es leche o si es filete, y el filete no es alérgeno. Eso lo resuelve
 * el nombre, que en BEDCA es inequívoco («Leche de vaca, entera» / «Vaca/buey,
 * parte s/e, asado»).
 */
export const FUENTES = {
  // --- cereales con gluten ---
  B1312: ["gluten"], // trigo (120 ingredientes)
  B1219: ["gluten"], // avena
  B1230: ["gluten"], // cebada
  B1313: ["gluten"], // centeno
  B1079: ["gluten"], // pasta alimenticia
  B1324: ["gluten"], // bizcocho, bollería
  B1421: ["gluten"], // croissant

  // --- legumbres del Anexo II (garbanzo, lenteja y alubia NO son alérgenos) ---
  B1452: ["soja"],
  B1337: ["cacahuetes"],
  B1701: ["altramuces"],

  // --- frutos de cáscara (lista cerrada) ---
  B1272: ["frutos_cascara"], // almendra
  B1533: ["frutos_cascara"], // avellana
  B1221: ["frutos_cascara"], // anacardo
  B1290: ["frutos_cascara"], // nuez
  B1213: ["frutos_cascara"], // «frutos secos» genérico

  // --- otros ---
  B1226: ["sesamo"],
  B2069: ["mostaza"],
  B1282: ["apio"],

  // --- quesos: la fuente ya es el queso, no hace falta mirar la parte ---
  B1183: ["leche"], B1328: ["leche"], B2247: ["leche"], B2101: ["leche"],
  B2245: ["leche"], B2244: ["leche"], B2974: ["leche"], B1161: ["leche"],
  B1087: ["leche"], // leche materna

  // --- pescado: 55 fuentes, todas del grupo «Pescados y mariscos» ---
  B1021: ["pescado"], B1043: ["pescado"], B1166: ["pescado"], B1222: ["pescado"],
  B1228: ["pescado"], B1258: ["pescado"], B1264: ["pescado"], B1269: ["pescado"],
  B1291: ["pescado"], B1293: ["pescado"], B1340: ["pescado"], B1392: ["pescado"],
  B1423: ["pescado"], B1427: ["pescado"], B1441: ["pescado"], B1496: ["pescado"],
  B1511: ["pescado"], B1524: ["pescado"], B1554: ["pescado"], B1557: ["pescado"],
  B1558: ["pescado"], B1571: ["pescado"], B1581: ["pescado"], B1586: ["pescado"],
  B1640: ["pescado"], B1763: ["pescado"], B1783: ["pescado"], B1823: ["pescado"],
  B1840: ["pescado"], B1842: ["pescado"], B1854: ["pescado"], B1861: ["pescado"],
  B1878: ["pescado"], B1881: ["pescado"], B1906: ["pescado"], B1911: ["pescado"],
  B2003: ["pescado"], B2116: ["pescado"], B2250: ["pescado"], B2251: ["pescado"],
  B2299: ["pescado"], B2388: ["pescado"], B2401: ["pescado"], B2490: ["pescado"],
  B2567: ["pescado"], B2706: ["pescado"], B2708: ["pescado"], B2710: ["pescado"],
  B2858: ["pescado"], B2859: ["pescado"], B2871: ["pescado"], B2900: ["pescado"],
  B3361: ["pescado"], B3362: ["pescado"], B1792: ["pescado"],

  // --- crustáceos: 9 fuentes ---
  B1237: ["crustaceos"], B1505: ["crustaceos"], B1998: ["crustaceos"],
  B2127: ["crustaceos"], B2222: ["crustaceos"], B2320: ["crustaceos"],
  B2486: ["crustaceos"], B2614: ["crustaceos"], B2686: ["crustaceos"],

  // --- moluscos: 11 fuentes ---
  B1205: ["moluscos"], B1223: ["moluscos"], B1224: ["moluscos"],
  B1317: ["moluscos"], B1331: ["moluscos"], B1489: ["moluscos"],
  B1514: ["moluscos"], B1644: ["moluscos"], B2114: ["moluscos"],
  B2590: ["moluscos"], B2925: ["moluscos"],
};

/**
 * Leche: hace falta la fuente Y la parte.
 *
 * Que algo venga de una vaca no dice si es leche o si es filete, y el filete no
 * es alérgeno. La faceta C de LanguaL —«parte del animal»— sí lo dice, y se
 * comprobó mirando quién lleva cada código: C0235 son leches y batidos, C0245
 * cuajadas y quesos, C0179 mantequillas, C0113 natas y C0195 cremas. Los B1201
 * que no llevan ninguno de esos son callos, cecina, corazón, hígado y lengua.
 *
 * «Batido fermentado de soja» también lleva C0235, pero su fuente es B1452
 * —soja—, así que no entra por aquí. Por eso hacen falta las dos cosas.
 */
export const FUENTES_LACTEAS = ["B1201", "B2611", "B2610"]; // vaca, cabra, oveja
export const PARTES_LACTEAS = ["C0235", "C0245", "C0179", "C0113", "C0195"];

/**
 * Fuentes que el cruce automático proponía y NO son alérgeno. Se dejan escritas
 * para que nadie las vuelva a meter «arreglando» la tabla.
 */
export const FUENTES_DESCARTADAS = {
  B1352: "tapioca — el automático la marcó de apio porque t-APIO-ca",
  B1495: "romero — lo marcó de pescado porque contiene «mero»",
  B2900: "cabracho — lo marcó de leche porque contiene «cabra»; es pescado",
  B1544: "castaña — no está en la lista cerrada de frutos de cáscara",
  B1596: "piñón — tampoco está en la lista, aunque sea alérgeno frecuente",
  B1349: "corazón de ternera — es carne, no leche",
  B1248: "mezcla el aceite de colza con el rape en BEDCA; el rape entra por nombre",
  B0001: "fuente genérica, de todo un poco: bocadillo, chanquete… va por nombre",
  B1214: "nuez moscada — es una especia, no un fruto de cáscara",
};

/**
 * El nombre, para lo que la fuente no puede saber: las recetas.
 *
 * Cada expresión se prueba contra el nombre sin tildes y en minúsculas. Los
 * límites de palabra importan: sin ellos «tapioca» sería apio.
 */
export const RECETAS = [
  // leche
  // «croqueta», «pizza», «lasaña» y «canelones» llevan leche casi siempre en la
  // cocina de aquí. Se marcan a sabiendas de que alguna receta no la lleve: en
  // alergias, avisar de más molesta y avisar de menos hace daño.
  [/\b(leche|lacte[oa]|lactosa|queso|quesito|yogur|yoghurt|cuajada|cuajo|nata|mantequilla|requeson|kefir|petit|natilla|flan|helado|mousse|bechamel|crema pastelera|crema inglesa|crema de leche|suero lacteo|batido lacteo|cremoso|croqueta|pizza|lasa[nñ]a|canelon|gratin|carbonara)/, ["leche"]],
  // huevo
  [/\b(huevo|huevos|clara de|yema de|tortilla|mayonesa|alioli|merengue|ovoproducto|crema pastelera|crema inglesa|flan|natilla|rebozad|empanad|croqueta|bizcocho|magdalena|bolleria|foie gras)/, ["huevos"]],
  // gluten
  [/\b(trigo|centeno|cebada|avena|espelta|kamut|triticale|semola|semolina|cuscus|couscous|bulgur|malta|maltead|pan\b|panes\b|pan de|pan rallado|pasta alimenticia|macarr|espagueti|fideo|tallarin|lasa[nñ]a|canelon|galleta|bolleria|bizcocho|croissant|magdalena|empanad|pizza|harina|cerveza|seitan|rebozad|croqueta|torrija|churro|donut|gofre|tostada|biscote|muesli|bocadillo|sandwich|hamburguesa|perrito|pastel|tarta|hojaldre|masa)/, ["gluten"]],
  // frutos de cáscara y cacahuete en recetas
  [/\b(turron|mazapan|praline|nougat|crema de cacahuete|crema de almendra|batido de almendras)/, ["frutos_cascara"]],
  [/\b(cacahuete|mani\b)/, ["cacahuetes"]],
  // soja
  [/\b(soja|tofu|tempeh|edamame|miso|tamari)/, ["soja"]],
  // sésamo, mostaza, apio
  [/\b(sesamo|ajonjoli|tahini|gomasio|hummus)/, ["sesamo"]],
  [/\bmostaza/, ["mostaza"]],
  [/\bapio(nabo)?\b/, ["apio"]],
  // pescado y marisco en recetas y salsas
  // «rape» y «chanquete» van por nombre: BEDCA le da al rape el mismo código de
  // fuente que al aceite de colza, y el chanquete cae en la fuente genérica.
  [/\b(surimi|palito de mar|anchoa|salsa worcester|paella|marisco|pescado|rape|chanquete|angula|gula)/, ["pescado"]],
  // el chipirón es de los siete ingredientes que se quedaron sin código de fuente
  [/\b(chipiron|chopito|puntilla)/, ["moluscos"]],
  // sulfitos: no se pueden medir, se deducen del tipo de producto
  [/\b(vino|vinagre|mosto|sidra|cava|champan|jerez|orujo|licor|vermut|fruta desecad|orejon|pasas|ciruela pasa|higo seco|albaricoque seco|patata deshidratad|zumo concentrado)/, ["sulfitos"]],
];

const sinTildes = (s) =>
  String(s).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Los alérgenos que se deducen de un ingrediente de BEDCA.
 *
 * @param {{nombre: string, langual?: string}} ingrediente
 * @returns {string[]} códigos, sin repetir y en orden estable
 */
export function derivarAlergenos(ingrediente) {
  const salida = new Set();

  const codigos = String(ingrediente.langual ?? "").split(/\s+/);

  const fuente = codigos.find((c) => c.startsWith("B"));
  if (fuente && FUENTES[fuente]) FUENTES[fuente].forEach((a) => salida.add(a));

  if (
    fuente &&
    FUENTES_LACTEAS.includes(fuente) &&
    codigos.some((c) => PARTES_LACTEAS.includes(c))
  )
    salida.add("leche");

  const texto = sinTildes(ingrediente.nombre);
  for (const [re, alergenos] of RECETAS)
    if (re.test(texto)) alergenos.forEach((a) => salida.add(a));

  return ALERGENOS_ESTANDAR.map((a) => a.codigo).filter((c) => salida.has(c));
}
