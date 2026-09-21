"use client";

import { useEffect, useRef } from "react";

/**
 * La pregunta de antes de encender nada.
 *
 * Sale siempre, incluso en el móvil, porque desde el móvil también se puede
 * querer usar otro aparato —una tableta apoyada, un segundo teléfono—. Y
 * porque una pregunta que unas veces sale y otras no es peor que una que sale
 * siempre: se aprende dónde está el botón.
 *
 * En su fichero porque la hacen dos sitios: el alta por código, con sesión, y
 * el comparador público, sin ella. La pregunta es la misma.
 */
export default function ElegirCamara({
  onAqui,
  onOtro,
  onCerrar,
}: {
  onAqui: () => void;
  onOtro: () => void;
  onCerrar: () => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  return (
    <dialog ref={dialogo} className="elegir-camara" onClose={onCerrar} onCancel={onCerrar}>
      <h2>¿Quieres usar la cámara de otro dispositivo para escanear?</h2>
      <p className="tenue">
        Si estás en el ordenador, sale a cuenta: el móvil hace de cámara y el
        producto aparece aquí para que lo revises.
      </p>
      <div className="opciones">
        <button type="button" className="azul grande" onClick={onOtro}>
          Sí, usar otro dispositivo
        </button>
        <button type="button" className="grande" onClick={onAqui}>
          No, continuar aquí
        </button>
      </div>
      <button type="button" className="enlace" onClick={onCerrar}>
        Cancelar
      </button>
    </dialog>
  );
}
