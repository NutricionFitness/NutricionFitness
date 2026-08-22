/**
 * Códigos de barras: comprobarlos y decidir con cuál se pregunta.
 *
 * Un lector de códigos se equivoca. Con la cámara de un móvil, mala luz y un
 * envase arrugado, se equivoca más. Por eso lo primero que se hace con lo que
 * sale del escáner es comprobar su dígito de control, que es exactamente para
 * lo que existe: cazar el dígito mal leído antes de que se convierta en un
 * producto equivocado dentro de una dieta.
 *
 * Este fichero no depende de nada. Es la pieza que se puede probar de verdad.
 */

/**
 * El dígito de control de un GTIN, sea de 8, 12, 13 o 14 dígitos.
 *
 * La regla es la misma para los cuatro formatos si se cuenta **desde la
 * derecha**: al dígito más a la derecha (sin contar el de control) le toca peso
 * 3, al siguiente 1, y así alternando. Escrito desde la izquierda hay que
 * cambiar el arranque según la longitud sea par o impar, que es de donde salen
 * la mitad de las implementaciones mal hechas de esto.
 *
 * @param sinControl los dígitos SIN el último.
 */
export function digitoControl(sinControl: string): number {
  let suma = 0;
  for (let i = sinControl.length - 1, peso = 3; i >= 0; i--, peso = peso === 3 ? 1 : 3)
    suma += Number(sinControl[i]) * peso;
  return (10 - (suma % 10)) % 10;
}

export interface CodigoBarras {
  /** El código tal cual, ya sin separadores. Es lo que se guarda. */
  codigo: string;
  /**
   * Con qué códigos preguntar a Open Food Facts, y en qué orden.
   *
   * No es una sola cosa porque el mismo producto puede estar dado de alta con
   * el código «como se imprime» o rellenado con ceros a la izquierda hasta 13.
   * Un UPC-A americano de 12 dígitos —lo típico de los frutos secos o los
   * suplementos importados— aparece de las dos maneras según quién lo subiera.
   * Preguntar dos veces cuesta una petición más y solo pasa cuando la primera
   * falla.
   */
  consultas: string[];
}

/**
 * Limpia y comprueba un código. Devuelve null si no es un código válido.
 *
 * Acepta lo que teclea una persona (con espacios o guiones) y lo que devuelve
 * el escáner. Rechaza:
 *
 *   · longitudes que no son de ningún GTIN,
 *   · dígitos de control que no cuadran —una lectura mala—,
 *   · el 0000000000000 y demás códigos de relleno que a veces salen de un
 *     escáner que ha leído cualquier cosa.
 */
export function normalizarEan(bruto: string): CodigoBarras | null {
  const d = (bruto ?? "").replace(/\D+/g, "");
  if (![8, 12, 13, 14].includes(d.length)) return null;

  // Todo ceros no es un producto: es un escáner leyendo una sombra.
  if (/^0+$/.test(d)) return null;

  if (Number(d[d.length - 1]) !== digitoControl(d.slice(0, -1))) return null;

  const consultas: string[] = [d];

  // Rellenado con ceros hasta 13, que es como Open Food Facts guarda casi todo.
  if (d.length < 13) {
    const a13 = d.padStart(13, "0");
    if (!consultas.includes(a13)) consultas.push(a13);
  }

  // Un GTIN-14 es el código de un embalaje: un dígito indicador delante y el
  // producto detrás. Dentro de la caja de doce yogures hay el mismo yogur, así
  // que vale la pena preguntar también por él.
  //
  // El dígito de control hay que **recalcularlo**, no heredarlo. Solo coincide
  // cuando el indicador es 0, porque un cero a la izquierda no suma; con
  // cualquier otro indicador, copiarlo daría un código que no existe.
  if (d.length === 14) {
    const cuerpo = d.slice(1, 13);
    const a13 = cuerpo + digitoControl(cuerpo);
    if (!consultas.includes(a13)) consultas.push(a13);
  }

  return { codigo: d, consultas };
}
