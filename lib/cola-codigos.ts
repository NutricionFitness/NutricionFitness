/**
 * Una cola de códigos que se procesan de uno en uno y en orden.
 *
 * Esto existía antes metido en un `useEffect` de `AltaPorCodigo`, y estaba mal
 * de una forma que no daba ningún error: el efecto llevaba en sus dependencias
 * el mismo estado que él escribía —`buscando`— y usaba su función de limpieza
 * para cancelarse. Al hacer `setBuscando(true)` React vuelve a pintar, ejecuta
 * la limpieza del efecto anterior, la bandera de «sigo vivo» pasa a false, y
 * cuando volvía la consulta se descartaba. El código llegaba, se contaba en
 * pantalla, y no aparecía nada. Además el estado se quedaba en «Buscando…»
 * para siempre.
 *
 * La lección: **un efecto no puede depender del estado que él mismo escribe si
 * además usa su limpieza para cancelarse.** Y la consecuencia práctica: esto se
 * saca de React, donde no se puede probar sin montar medio navegador, y se deja
 * como una función normal con su batería.
 *
 * Sin dependencias y sin tocar el DOM.
 */

export interface EstadoCola {
  /** El código que se está mirando ahora mismo, o null si no hay ninguno. */
  mirando: string | null;
  /** Cuántos quedan por mirar, contando el de ahora. */
  pendientes: number;
}

export interface ColaCodigos {
  /** Mete un código. Si ya está en la cola, no se repite. */
  encolar(codigo: string): void;
  /** Se acabó: ni se procesa lo que queda ni se vuelve a avisar. */
  parar(): void;
}

export function colaDeCodigos(
  /** Qué hacer con cada código. Se llama de uno en uno, nunca en paralelo. */
  procesar: (codigo: string) => Promise<void>,
  /** Se llama cada vez que cambia lo que hay que pintar. */
  alCambiar: (estado: EstadoCola) => void = () => {},
): ColaCodigos {
  const cola: string[] = [];
  let trabajando = false;
  let parada = false;
  let mirando: string | null = null;

  const avisar = () => alCambiar({ mirando, pendientes: cola.length });

  async function vaciar() {
    // Un solo trabajador: si ya hay uno dando vueltas, el nuevo código lo
    // recogerá él en la siguiente vuelta.
    if (trabajando) return;
    trabajando = true;

    try {
      while (cola.length && !parada) {
        mirando = cola[0];
        avisar();

        try {
          await procesar(mirando);
        } catch {
          // Un código que falla no puede atascar a los que vienen detrás.
        }
        if (parada) return;

        // Fuera de la cola pase lo que pase. Si un código que ha fallado se
        // quedara, el siguiente no entraría nunca.
        cola.shift();
        mirando = null;
        avisar();
      }
    } finally {
      trabajando = false;
      mirando = null;
      if (!parada) avisar();
    }
  }

  return {
    encolar(codigo: string) {
      if (parada || cola.includes(codigo)) return;
      cola.push(codigo);
      avisar();
      void vaciar();
    },
    parar() {
      parada = true;
      cola.length = 0;
    },
  };
}
