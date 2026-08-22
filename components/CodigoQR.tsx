"use client";

import { useMemo } from "react";

import { codigoQR } from "@/lib/qr/codificar";

/**
 * Un código QR dibujado como SVG.
 *
 * En SVG y no en un lienzo por dos razones. Una, que escala sin perder filo: la
 * misma etiqueta se ve nítida en una pantalla normal y en una de mucha
 * densidad, y un lector agradece los bordes limpios. Y otra, que se imprime
 * bien, que en esta app no es una casualidad —la hoja de la dieta también se
 * imprime—.
 *
 * Los colores van fijos en negro sobre blanco, sin usar los tokens del tema.
 * Un QR en gris sobre gris oscuro es un QR que no se lee: los lectores buscan
 * contraste, no elegancia. El blanco se pinta como un rectángulo propio, así
 * que también funciona con el tema oscuro puesto.
 */
export default function CodigoQR({
  texto,
  tamano = 220,
  titulo = "Código QR para vincular el móvil",
}: {
  texto: string;
  /** Lado en píxeles CSS. Los módulos se ajustan solos. */
  tamano?: number;
  titulo?: string;
}) {
  const modulos = useMemo(() => {
    try {
      return codigoQR(texto);
    } catch {
      return null;
    }
  }, [texto]);

  if (!modulos) return <p className="aviso">No se ha podido generar el código.</p>;

  // Cuatro módulos de zona muda a cada lado: es lo que manda la norma y lo
  // primero que se olvida. Sin ese margen, muchos lectores no lo encuentran.
  const muda = 4;
  const lado = modulos.length + muda * 2;

  // Un solo `path` con todos los cuadrados en vez de un `<rect>` por módulo:
  // con 2.500 módulos, 2.500 elementos hacen sudar al navegador y engordan el
  // marcado sin que se vea ninguna diferencia.
  let d = "";
  for (let f = 0; f < modulos.length; f++)
    for (let c = 0; c < modulos.length; c++)
      if (modulos[f][c]) d += `M${c + muda} ${f + muda}h1v1h-1z`;

  return (
    <svg
      className="qr"
      width={tamano}
      height={tamano}
      viewBox={`0 0 ${lado} ${lado}`}
      role="img"
      aria-label={titulo}
      shapeRendering="crispEdges"
    >
      <rect width={lado} height={lado} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
