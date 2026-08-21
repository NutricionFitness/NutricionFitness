"use client";

import { useEffect, useRef, useState } from "react";

/** Quita tildes y baja a minúsculas: «lacteos» tiene que encontrar «Lácteos». */
const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Filtro por grupo, escribiendo y eligiendo.
 *
 * Era un campo de texto libre que solo valía si acertabas el nombre exacto,
 * tildes incluidas. Ahora se escribe para buscar —«carne» saca «Carnes y
 * derivados»— y se eligen los que se quieran: los grupos elegidos se apilan como
 * etiquetas y la búsqueda los une con un «o».
 *
 * Cada grupo elegido lleva su `input` oculto con el mismo `name`, que es como se
 * mandan varios valores del mismo campo en un formulario GET de toda la vida:
 * `?grupo=Frutas&grupo=Legumbres`. No hace falta JSON ni comas que luego haya
 * que separar.
 */
export default function SelectorGrupos({
  grupos,
  elegidos: iniciales,
}: {
  grupos: string[];
  elegidos: string[];
}) {
  const [elegidos, setElegidos] = useState(iniciales);
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const primeraVez = useRef(true);

  // El formulario se envía DESPUÉS de pintar, no dentro del manejador: si se
  // enviara ahí, el campo oculto del grupo recién elegido todavía no existiría
  // en el DOM y ese grupo se perdería por el camino.
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    caja.current?.closest("form")?.requestSubmit();
  }, [elegidos]);

  const busca = sinTildes(texto);
  const libres = grupos.filter((g) => !elegidos.includes(g));
  const sugeridos = busca ? libres.filter((g) => sinTildes(g).includes(busca)) : libres;

  function anadir(g: string) {
    setElegidos([...elegidos, g]);
    setTexto("");
    setAbierto(false);
  }

  function quitar(g: string) {
    setElegidos(elegidos.filter((x) => x !== g));
  }

  return (
    <div className="grupos" ref={caja}>
      {elegidos.map((g) => (
        <span key={g} className="chip elegido">
          {g}
          <button
            type="button"
            onClick={() => quitar(g)}
            aria-label={`Quitar el grupo ${g}`}
            title={`Quitar ${g}`}
          >
            ✕
          </button>
          <input type="hidden" name="grupo" value={g} />
        </span>
      ))}

      <div className="buscador caja-grupo">
        <input
          value={texto}
          placeholder={elegidos.length ? "Añadir otro grupo…" : "Grupo (todos)"}
          aria-label="Filtrar por grupo"
          aria-expanded={abierto}
          autoComplete="off"
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Enter elige el primero de la lista; sin esto enviaría el
              // formulario con el texto a medias y sin haber elegido nada.
              e.preventDefault();
              if (sugeridos[0]) anadir(sugeridos[0]);
            }
            if (e.key === "Escape") {
              setAbierto(false);
              setTexto("");
            }
            if (e.key === "Backspace" && !texto && elegidos.length)
              quitar(elegidos[elegidos.length - 1]);
          }}
        />

        {abierto && (
          <ul className="sugerencias">
            {sugeridos.length === 0 ? (
              <li className="sin-grupos">
                {libres.length === 0
                  ? "Ya están todos elegidos."
                  : `Ningún grupo se llama «${texto}».`}
              </li>
            ) : (
              sugeridos.map((g) => (
                <li key={g}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => anadir(g)}
                  >
                    {g}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
