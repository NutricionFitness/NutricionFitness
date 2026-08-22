"use client";

import { useState } from "react";

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Un grupo, escribiendo para encontrarlo.
 *
 * Es un desplegable, no un campo libre: al salir sin haber elegido, el texto a
 * medias se descarta y vuelve lo que hubiera. Si valiera cualquier cosa escrita
 * acabarías con «Lacteos», «lácteos» y «Lácteos » como tres grupos distintos, y
 * el filtro del catálogo dejaría de servir.
 */
export default function SelectorGrupoUnico({
  grupos,
  valor,
  onCambiar,
  id,
}: {
  grupos: string[];
  valor: string | null;
  onCambiar: (g: string | null) => void;
  id?: string;
}) {
  const [texto, setTexto] = useState(valor ?? "");
  const [abierto, setAbierto] = useState(false);

  const busca = sinTildes(texto);
  // Si lo escrito es ya el grupo elegido, se enseñan todos: si no, al volver a
  // abrirlo solo te ofrecería el que ya tienes puesto.
  const sugeridos =
    busca && busca !== sinTildes(valor ?? "")
      ? grupos.filter((g) => sinTildes(g).includes(busca))
      : grupos;

  function elegir(g: string) {
    setTexto(g);
    onCambiar(g);
    setAbierto(false);
  }

  function limpiar() {
    setTexto("");
    onCambiar(null);
  }

  return (
    <div className="buscador">
      <input
        id={id}
        value={texto}
        placeholder="Sin grupo"
        autoComplete="off"
        aria-expanded={abierto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() =>
          setTimeout(() => {
            setAbierto(false);
            setTexto(valor ?? "");
          }, 150)
        }
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (sugeridos[0]) elegir(sugeridos[0]);
          }
          if (e.key === "Escape") {
            setAbierto(false);
            setTexto(valor ?? "");
          }
        }}
        style={{ width: "100%", paddingRight: valor ? 30 : undefined }}
      />

      {valor && (
        <button
          type="button"
          className="limpiar-grupo"
          onMouseDown={(e) => e.preventDefault()}
          onClick={limpiar}
          title="Dejarlo sin grupo"
          aria-label="Dejarlo sin grupo"
        >
          ✕
        </button>
      )}

      {abierto && (
        <ul className="sugerencias">
          {sugeridos.length === 0 ? (
            <li className="sin-grupos">Ningún grupo se llama «{texto}».</li>
          ) : (
            sugeridos.map((g) => (
              <li key={g}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegir(g)}
                >
                  {g}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
