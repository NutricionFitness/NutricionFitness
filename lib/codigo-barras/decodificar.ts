/**
 * Leer un EAN-13 o un EAN-8 de una línea de píxeles.
 *
 * ¿Por qué no una librería? Porque la mayoría de los navegadores ya traen
 * `BarcodeDetector`, que es nativo y mejor que cualquier cosa escrita aquí. Lo
 * único que falta es el respaldo para Safari en iPhone, que no lo implementa, y
 * para eso una librería de lectura de códigos son entre 200 y 400 kB que se
 * descarga todo el mundo para algo que casi nadie va a usar.
 *
 * Un EAN es además el código más fácil que existe: 95 módulos de anchura fija,
 * diez patrones de dígito y un dígito de control que descarta las lecturas
 * malas. Cabe en un fichero y se puede probar de verdad, que es más de lo que
 * se puede decir de una dependencia.
 *
 * Sin dependencias y sin tocar el DOM: entra un vector de grises, sale un
 * código o null.
 */

/**
 * Los diez dígitos, en anchuras de sus cuatro tramos.
 *
 * Cada dígito ocupa 7 módulos repartidos en cuatro tramos que se alternan
 * claro/oscuro. En la mitad izquierda empieza por claro y en la derecha por
 * oscuro, pero **las anchuras son las mismas**, porque el código de la derecha
 * es el complemento del de la izquierda. Por eso hay una sola tabla.
 *
 * El código G —el que se usa en la mitad izquierda para cifrar el primer
 * dígito— es esta misma tabla leída al revés.
 */
const ANCHURAS = [
  [3, 2, 1, 1], // 0
  [2, 2, 2, 1], // 1
  [2, 1, 2, 2], // 2
  [1, 4, 1, 1], // 3
  [1, 1, 3, 2], // 4
  [1, 2, 3, 1], // 5
  [1, 1, 1, 4], // 6
  [1, 3, 1, 2], // 7
  [1, 2, 1, 3], // 8
  [3, 1, 1, 2], // 9
];

/**
 * Qué primer dígito significa cada patrón de paridades de la mitad izquierda.
 *
 * El EAN-13 tiene trece dígitos y solo doce caben en las barras: el primero no
 * se dibuja, se cifra en si cada uno de los seis dígitos de la izquierda usa el
 * código L (0) o el G (1). Es la parte del formato que sorprende a todo el
 * mundo la primera vez.
 */
const PARIDADES: Record<string, number> = {
  "000000": 0,
  "001011": 1,
  "001101": 2,
  "001110": 3,
  "010011": 4,
  "011001": 5,
  "011100": 6,
  "010101": 7,
  "010110": 8,
  "011010": 9,
};

interface Tramo {
  oscuro: boolean;
  ancho: number;
}

/**
 * De grises a tramos claros y oscuros.
 *
 * El umbral se calcula por línea a partir de su propio mínimo y máximo, no con
 * un número fijo: una etiqueta a contraluz y otra bajo el fluorescente de la
 * cocina no tienen nada que ver, y un umbral fijo solo acierta en una de las
 * dos.
 */
export function aTramos(grises: ArrayLike<number>): Tramo[] {
  const n = grises.length;
  if (n < 20) return [];

  let min = 255;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = grises[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Sin contraste no hay código: es pared, mesa o un dedo tapando.
  if (max - min < 40) return [];

  const umbral = (min + max) / 2;
  const tramos: Tramo[] = [];
  let oscuro = grises[0] < umbral;
  let ancho = 1;

  for (let i = 1; i < n; i++) {
    const esOscuro = grises[i] < umbral;
    if (esOscuro === oscuro) ancho++;
    else {
      tramos.push({ oscuro, ancho });
      oscuro = esOscuro;
      ancho = 1;
    }
  }
  tramos.push({ oscuro, ancho });
  return tramos;
}

/**
 * Qué dígito son estos cuatro tramos, y con qué código.
 *
 * Se compara por **proporción**, no por número de píxeles: el módulo mide lo
 * que mida según lo lejos que esté el envase, y lo único estable es que los
 * cuatro tramos suman 7 módulos.
 *
 * Devuelve también el error de la mejor coincidencia para poder descartar un
 * tramo que no se parece a ningún dígito en vez de quedarse con el menos malo.
 */
function leerDigito(
  anchos: number[],
  modulo: number,
): { digito: number; invertido: boolean; error: number } | null {
  let mejor: { digito: number; invertido: boolean; error: number } | null = null;

  for (let d = 0; d < 10; d++) {
    for (const invertido of [false, true]) {
      const patron = invertido ? [...ANCHURAS[d]].reverse() : ANCHURAS[d];
      let error = 0;
      for (let i = 0; i < 4; i++) error += Math.abs(anchos[i] / modulo - patron[i]);
      if (!mejor || error < mejor.error) mejor = { digito: d, invertido, error };
    }
  }

  // Un tramo que se desvía más de 1,2 módulos en total no es un dígito
  // borroso: es otra cosa. Sin este corte, cualquier textura «decodifica».
  return mejor && mejor.error < 1.2 ? mejor : null;
}

/** Los dos formatos que sabe leer, en tramos y en módulos. */
const FORMATOS = [
  { digitos: 12, tramos: 59, modulos: 95 }, // EAN-13: 12 dibujados + 1 en la paridad
  { digitos: 8, tramos: 43, modulos: 67 }, // EAN-8
];

/** Suma de las anchuras de `cuantos` tramos desde `desde`. */
const suma = (tramos: Tramo[], desde: number, cuantos: number) => {
  let t = 0;
  for (let i = desde; i < desde + cuantos; i++) t += tramos[i].ancho;
  return t;
};

/**
 * Intenta leer un código empezando exactamente en el tramo `inicio`.
 *
 * No busca la marca de inicio comparando barras: da por bueno el arranque,
 * decodifica entero y deja que **el dígito de control** diga si era un código o
 * era el borde de una servilleta. Es menos código y descarta mejor.
 */
function leerDesde(tramos: Tramo[], inicio: number): string | null {
  for (const f of FORMATOS) {
    if (inicio + f.tramos > tramos.length) continue;

    const modulo = suma(tramos, inicio, f.tramos) / f.modulos;
    if (modulo < 0.6) continue; // demasiado pequeño para distinguir nada

    // Las tres marcas —inicio, centro y fin— tienen que medir un módulo cada
    // tramo. Es una comprobación de un instante que descarta casi todo.
    const marcas = [
      [inicio, 3],
      [inicio + 3 + (f.digitos / 2) * 4, 5],
      [inicio + f.tramos - 3, 3],
    ] as const;
    let marcasBien = true;
    for (const [desde, cuantos] of marcas)
      for (let i = desde; i < desde + cuantos; i++)
        if (Math.abs(tramos[i].ancho / modulo - 1) > 0.5) marcasBien = false;
    if (!marcasBien) continue;

    // La primera barra tiene que ser oscura: si no, se está leyendo el hueco.
    if (!tramos[inicio].oscuro) continue;

    const digitos: number[] = [];
    const paridades: string[] = [];
    let roto = false;

    for (let d = 0; d < f.digitos && !roto; d++) {
      const mitadDerecha = d >= f.digitos / 2;
      // Tres tramos de marca al principio, y cinco más al pasar el centro.
      const desde = inicio + 3 + d * 4 + (mitadDerecha ? 5 : 0);
      const anchos = [0, 1, 2, 3].map((i) => tramos[desde + i].ancho);

      const leido = leerDigito(anchos, modulo);
      if (!leido) {
        roto = true;
        break;
      }
      digitos.push(leido.digito);
      // A la izquierda, «invertido» quiere decir código G, que es un 1 de
      // paridad. A la derecha no hay G: si sale invertido, se está leyendo el
      // código del revés y lo cazará el dígito de control.
      if (!mitadDerecha) paridades.push(leido.invertido ? "1" : "0");
    }
    if (roto) continue;

    let codigo: string;
    if (f.digitos === 12) {
      const primero = PARIDADES[paridades.join("")];
      if (primero === undefined) continue;
      codigo = String(primero) + digitos.join("");
    } else {
      codigo = digitos.join("");
    }

    if (controlCorrecto(codigo)) return codigo;
  }

  return null;
}

/** El mismo cálculo que `ean.ts`, repetido para no atar esto a aquello. */
function controlCorrecto(codigo: string): boolean {
  let s = 0;
  for (let i = codigo.length - 2, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3)
    s += Number(codigo[i]) * peso;
  return (10 - (s % 10)) % 10 === Number(codigo[codigo.length - 1]);
}

/**
 * Lee una línea de grises. Devuelve el código o null.
 *
 * Prueba a empezar en cada tramo oscuro, y también con la línea del revés:
 * un código se lee igual de bien puesto boca abajo, y a nadie se le ocurre
 * girar el bote.
 */
export function leerLinea(grises: ArrayLike<number>): string | null {
  const tramos = aTramos(grises);
  if (tramos.length < 43) return null;

  for (const t of [tramos, [...tramos].reverse()])
    for (let i = 0; i < t.length - 42; i++)
      if (t[i].oscuro) {
        const codigo = leerDesde(t, i);
        if (codigo) return codigo;
      }

  return null;
}

/**
 * Lee un fotograma entero probando varias líneas horizontales.
 *
 * Se barre solo la franja central: es donde apunta la gente, y recorrer la
 * imagen entera cuesta tiempo que se emplea mejor en mirar el fotograma
 * siguiente. Las líneas van alternando desde el centro hacia afuera para que el
 * caso normal —el código centrado— salga en las primeras.
 *
 * @param datos  RGBA tal cual lo devuelve `getImageData`.
 */
export function leerFotograma(
  datos: Uint8ClampedArray,
  ancho: number,
  alto: number,
  lineas = 15,
): string | null {
  const grises = new Uint8ClampedArray(ancho);
  const franja = Math.floor(alto * 0.35);
  const centro = Math.floor(alto / 2);

  for (let k = 0; k < lineas; k++) {
    // 0, +1, −1, +2, −2… escalados a la franja.
    const paso = Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1);
    const y = centro + Math.round((paso / Math.max(1, lineas / 2)) * franja);
    if (y < 0 || y >= alto) continue;

    const base = y * ancho * 4;
    for (let x = 0; x < ancho; x++) {
      const p = base + x * 4;
      // Luminancia. El verde pesa más porque el ojo —y el sensor— ven así.
      grises[x] = (datos[p] * 77 + datos[p + 1] * 150 + datos[p + 2] * 29) >> 8;
    }

    const codigo = leerLinea(grises);
    if (codigo) return codigo;
  }

  return null;
}
