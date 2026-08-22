"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  asignarAlergia,
  crearAlergeno,
  quitarAlergia,
} from "@/app/alergenos/acciones";
import type { Alergeno } from "@/app/alergenos/consultas";

const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * A qué es alérgica una persona.
 *
 * El catálogo trae los catorce del Anexo II, pero no todo lo que hace daño está
 * ahí: la fructosa, el piñón o la castaña no son alérgenos de declaración
 * obligatoria y hay quien no los tolera. Por eso se pueden declarar propios.
 */
export default function AlergiasPersona({
  personaId,
  catalogo,
  alergias,
}: {
  personaId: string;
  catalogo: Alergeno[];
  alergias: Alergeno[];
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [declarando, setDeclarando] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const puestas = new Set(alergias.map((a) => a.id));
  const busca = sinTildes(texto);
  const libres = catalogo.filter((a) => !puestas.has(a.id));
  const sugeridos = busca
    ? libres.filter((a) => sinTildes(`${a.nombre} ${a.detalle ?? ""}`).includes(busca))
    : libres;

  const conFallo = (fn: () => Promise<unknown>) =>
    iniciar(async () => {
      setFallo(null);
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setFallo(e instanceof Error ? e.message : "No se ha podido guardar.");
      }
    });

  function declarar() {
    const nombre = nuevo.trim();
    if (!nombre) return;
    conFallo(async () => {
      const id = await crearAlergeno(nombre);
      await asignarAlergia(personaId, id);
      setNuevo("");
      setDeclarando(false);
    });
  }

  return (
    <div className="tarjeta alergias">
      <div className="fila">
        <h2>Alergias e intolerancias</h2>
        <span style={{ flex: 1 }} />
        {alergias.length > 0 && (
          <span className="chip alergia">{alergias.length}</span>
        )}
      </div>

      {alergias.length === 0 ? (
        <p className="tenue" style={{ margin: "8px 0 0", fontSize: 13.5 }}>
          Ninguna declarada. Si la añades, las dietas de esta persona avisarán
          cuando lleven un ingrediente que la contenga.
        </p>
      ) : (
        <div className="fila" style={{ gap: 6, marginTop: 10 }}>
          {alergias.map((a) => (
            <span key={a.id} className="chip alergia" title={a.detalle ?? undefined}>
              {a.nombre}
              <button
                type="button"
                disabled={pendiente}
                onClick={() => conFallo(() => quitarAlergia(personaId, a.id))}
                aria-label={`Quitar ${a.nombre}`}
                title={`Quitar ${a.nombre}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="fila" style={{ marginTop: 12, gap: 8 }}>
        <div className="buscador" style={{ flex: "1 1 220px", maxWidth: 340 }}>
          <input
            value={texto}
            placeholder="Añadir una alergia…"
            aria-label="Buscar un alérgeno"
            aria-expanded={abierto}
            autoComplete="off"
            disabled={pendiente}
            onChange={(e) => {
              setTexto(e.target.value);
              setAbierto(true);
            }}
            onFocus={() => setAbierto(true)}
            onBlur={() => setTimeout(() => setAbierto(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (sugeridos[0]) conFallo(() => asignarAlergia(personaId, sugeridos[0].id));
                setTexto("");
                setAbierto(false);
              }
              if (e.key === "Escape") setAbierto(false);
            }}
            style={{ width: "100%" }}
          />
          {abierto && (
            <ul className="sugerencias">
              {sugeridos.length === 0 ? (
                <li className="sin-grupos">
                  {libres.length === 0
                    ? "Ya están todas puestas."
                    : `Ninguna se llama «${texto}». Puedes declararla.`}
                </li>
              ) : (
                sugeridos.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        conFallo(() => asignarAlergia(personaId, a.id));
                        setTexto("");
                        setAbierto(false);
                      }}
                    >
                      {a.nombre}
                      {a.detalle && <small className="tenue"> · {a.detalle}</small>}
                      {!a.estandar && <small className="tenue"> · propia</small>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {!declarando && (
          <button type="button" onClick={() => setDeclarando(true)} disabled={pendiente}>
            Declarar una nueva
          </button>
        )}
      </div>

      {declarando && (
        <div className="fila" style={{ marginTop: 10, gap: 8 }}>
          <input
            value={nuevo}
            autoFocus
            placeholder="Fructosa, piñón, histamina…"
            aria-label="Nombre del alérgeno nuevo"
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") declarar();
              if (e.key === "Escape") setDeclarando(false);
            }}
            style={{ minWidth: 220 }}
          />
          <button className="principal" onClick={declarar} disabled={pendiente || !nuevo.trim()}>
            Declarar
          </button>
          <button type="button" onClick={() => setDeclarando(false)} disabled={pendiente}>
            Cancelar
          </button>
        </div>
      )}

      {declarando && (
        <p className="tenue" style={{ fontSize: 12.5, margin: "8px 0 0", maxWidth: "60ch" }}>
          Los catorce del Anexo II ya están en el catálogo. Esto es para lo que no
          está en él —fructosa, piñón, castaña—: después hay que decir qué
          ingredientes lo llevan, desde su ficha o en bloque desde el catálogo.
        </p>
      )}

      {fallo && <p className="aviso" style={{ marginTop: 10 }}>{fallo}</p>}
    </div>
  );
}
