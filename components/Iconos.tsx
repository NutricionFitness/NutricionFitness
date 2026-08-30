/**
 * Los iconos de la app, en línea.
 *
 * No hay librería de iconos: son cuatro trazos y meter una dependencia entera
 * para esto engorda el paquete que se descarga el navegador sin ganar nada.
 * Van con `currentColor`, así que heredan el color del botón que los lleva y
 * funcionan igual en claro que en oscuro.
 *
 * Ninguno lleva texto: el que los usa pone siempre `title` y `aria-label`, que
 * es lo que leen el ratón parado encima y el lector de pantalla.
 */

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconoCopiar() {
  return (
    <svg {...base}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2.4" />
      <path d="M5.5 15H4.6A1.6 1.6 0 0 1 3 13.4V4.6A1.6 1.6 0 0 1 4.6 3h8.8A1.6 1.6 0 0 1 15 4.6v.9" />
    </svg>
  );
}

export function IconoPapelera() {
  return (
    <svg {...base}>
      <path d="M4 6.5h16" />
      <path d="M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" />
      <path d="M6.2 6.5l.8 12.2c.05.8.7 1.4 1.5 1.4h7c.8 0 1.45-.6 1.5-1.4l.8-12.2" />
      <path d="M10.2 10.3v6M13.8 10.3v6" />
    </svg>
  );
}

export function IconoAyuda() {
  return (
    <svg {...base} width={14} height={14}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.85.8c0 1.7-2.45 2.3-2.45 3.9" />
      <path d="M12 17.4h.01" strokeWidth="2.4" />
    </svg>
  );
}

export function IconoCerrar() {
  return (
    <svg {...base} width={14} height={14} strokeWidth={2.2}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * Barras de anchura desigual, que es lo que hace reconocible un código.
 *
 * Con todas las barras iguales parece un ecualizador; el ojo lee «código de
 * barras» por la irregularidad, no por la cantidad de líneas.
 */
export function IconoCodigoBarras() {
  return (
    <svg {...base} strokeWidth={1.6}>
      <path d="M3.5 5v14M6.5 5v14" />
      <path d="M9.5 5v14" strokeWidth="2.6" />
      <path d="M13 5v14M15.5 5v14" />
      <path d="M18.5 5v14" strokeWidth="2.6" />
      <path d="M21 5v14" />
    </svg>
  );
}

/**
 * Una persona y una flecha: «esto se va con otro».
 *
 * No es la flecha sola —que en una fila de acciones se lee como «abrir»— ni dos
 * personas, que a 16 px se convierten en una mancha.
 */
export function IconoTransferir() {
  return (
    <svg {...base}>
      <circle cx="7.5" cy="7" r="3.2" />
      <path d="M2.8 20c0-2.7 2.1-4.7 4.7-4.7s4.7 2 4.7 4.7" />
      <path d="M14.6 11.2h6.4" />
      <path d="M18.3 8.5l2.7 2.7-2.7 2.7" />
    </svg>
  );
}
