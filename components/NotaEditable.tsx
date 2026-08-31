"use client";

import { useState, useTransition } from "react";

/**
 * Una nota de varias líneas, en línea, con lo que hace falta y nada más.
 *
 * La usan la cabecera de una persona y la de una dieta. Es un `<textarea>` y no
 * un `<input>` a propósito: una nota se escribe en varias líneas —«2 L de agua.
 * Entreno martes y jueves.»— y un campo de una sola línea las convierte en un
 * párrafo que hay que leer deslizando.
 *
 * Por eso `Enter` **no guarda**: en un `textarea` es un salto de línea, y
 * robárselo sería quitarle lo único que lo distingue de un `input`. Se guarda
 * con el botón o con `Ctrl`/`⌘`+`Enter`, y `Esc` cancela, que es lo que ya
 * hacen los otros campos en línea de la app.
 *
 * Vacío borra la nota: se guarda `null`, no una cadena vacía, para que la base
 * diga «no hay nota» y no «hay una nota que no pone nada».
 */
export default function NotaEditable({
  valor,
  etiquetaVacia = "añadir una nota",
  marcador,
  extra,
  onGuardar,
}: {
  valor: string | null;
  /** Lo que se lee cuando no hay nota todavía. */
  etiquetaVacia?: string;
  marcador?: string;
  /** Lo que va al lado de la nota cuando la hay. Para el interruptor de la hoja. */
  extra?: React.ReactNode;
  onGuardar: (texto: string | null) => Promise<void> | void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor ?? "");
  const [pendiente, iniciar] = useTransition();

  function guardar() {
    const limpio = texto.trim();
    iniciar(async () => {
      await onGuardar(limpio || null);
      setEditando(false);
    });
  }

  function cancelar() {
    setTexto(valor ?? "");
    setEditando(false);
  }

  if (editando)
    return (
      <div className="nota-editable editando">
        <textarea
          value={texto}
          autoFocus
          rows={3}
          placeholder={marcador}
          aria-label="Nota"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancelar();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) guardar();
          }}
        />
        <div className="fila">
          <button className="principal" onClick={guardar} disabled={pendiente}>
            {pendiente ? "Guardando…" : "Guardar"}
          </button>
          <button onClick={cancelar} disabled={pendiente}>
            Cancelar
          </button>
          <span className="tenue" style={{ fontSize: 12 }}>
            Ctrl+Enter guarda · Esc cancela
          </span>
        </div>
      </div>
    );

  return (
    <div className="nota-editable">
      {valor ? (
        <>
          {/* `pre-wrap`: lo que se escribió en tres líneas se lee en tres. */}
          <p className="texto">{valor}</p>
          <span className="acciones">
            <button className="enlace" onClick={() => setEditando(true)}>
              editar nota
            </button>
            {extra}
          </span>
        </>
      ) : (
        <button className="enlace" onClick={() => setEditando(true)}>
          {etiquetaVacia}
        </button>
      )}
    </div>
  );
}
