"use client";

import { useEffect, useState, useTransition } from "react";

import { buscarSustitutos, cambiarIngrediente } from "@/app/dietas/[id]/acciones";
import type { Macros, Sustitucion } from "@/lib/dominio/sustituir";

/**
 * Sustitutos para un componente.
 *
 * Todas las propuestas son **isoenergéticas**: la cantidad que se ofrece aporta
 * las mismas kilocalorías que lo que había. Así el total de la dieta no se
 * mueve y lo único que cambia es el reparto de macros, que es lo que se está
 * decidiendo.
 */
export default function PanelSustitucion({
  componenteId,
  ingredienteId,
  nombreActual,
  grupo,
  gramos,
  dietaId,
  objetivo,
  onCerrar,
  onHecho,
}: {
  componenteId: string;
  ingredienteId: number;
  nombreActual: string;
  grupo: string | null;
  gramos: number;
  dietaId: string;
  /** Si viene, se buscan los cambios que más acercan a ese reparto. */
  objetivo?: { macrosDieta: Macros; energiaDieta: number; objetivoPct: Partial<Macros> };
  onCerrar: () => void;
  onHecho: () => void;
}) {
  const [soloMismoGrupo, setSoloMismoGrupo] = useState(true);
  const [dirigido, setDirigido] = useState(Boolean(objetivo));
  const [propuestas, setPropuestas] = useState<Sustitucion[] | null>(null);
  const [pendiente, iniciar] = useTransition();

  useEffect(() => {
    let vigente = true;
    setPropuestas(null);
    buscarSustitutos({
      ingredienteId,
      gramos,
      grupo,
      soloMismoGrupo,
      ...(dirigido && objetivo ? objetivo : {}),
    }).then((r) => {
      if (vigente) setPropuestas(r);
    });
    return () => {
      vigente = false;
    };
  }, [ingredienteId, gramos, grupo, soloMismoGrupo, dirigido, objetivo]);

  function aplicar(s: Sustitucion) {
    iniciar(() =>
      cambiarIngrediente(componenteId, s.candidato.id, s.gramos, dietaId).then(onHecho),
    );
  }

  return (
    <tr>
      <td colSpan={9} style={{ background: "var(--panel)" }}>
        <div className="fila" style={{ justifyContent: "space-between" }}>
          <strong>Cambiar {nombreActual}</strong>
          <button className="enlace" onClick={onCerrar}>cerrar</button>
        </div>

        <div className="fila" style={{ margin: "8px 0", fontSize: 13 }}>
          <label className="fila" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={soloMismoGrupo}
              onChange={(e) => setSoloMismoGrupo(e.target.checked)}
              style={{ width: 15 }}
            />
            Solo del mismo grupo
          </label>
          {objetivo && (
            <label className="fila" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={dirigido}
                onChange={(e) => setDirigido(e.target.checked)}
                style={{ width: 15 }}
              />
              Los que más acercan al reparto pedido
            </label>
          )}
        </div>

        {propuestas === null ? (
          <p className="suave" style={{ margin: 0 }}>Buscando…</p>
        ) : propuestas.length === 0 ? (
          <p className="suave" style={{ margin: 0 }}>
            {dirigido
              ? "Ningún cambio de este componente acerca al reparto pedido. Prueba con otro, o desmarca «solo del mismo grupo»."
              : "No hay sustitutos razonables. Prueba a desmarcar «solo del mismo grupo»."}
          </p>
        ) : (
          <table style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>Sustituto</th>
                <th className="num">Cantidad</th>
                <th className="num">Prot</th>
                <th className="num">HC</th>
                <th className="num">Grasa</th>
                {dirigido && <th className="num">Acerca</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {propuestas.map((s) => (
                <tr key={s.candidato.id}>
                  <td>
                    {s.candidato.nombre}
                    {s.candidato.estado !== "desconocido" && (
                      <span className="chip" style={{ marginLeft: 6 }}>{s.candidato.estado}</span>
                    )}
                  </td>
                  <td className="num">{Math.round(s.gramos)} g</td>
                  {(["prot", "hc", "grasa"] as const).map((m) => (
                    <td key={m} className={`num ${s.delta[m] > 0 ? "mas" : s.delta[m] < 0 ? "menos" : "suave"}`}>
                      {s.delta[m] >= 0 ? "+" : ""}
                      {s.delta[m].toFixed(1)}
                    </td>
                  ))}
                  {dirigido && (
                    <td className="num mas">
                      {s.mejora?.toFixed(1)} pt
                    </td>
                  )}
                  <td className="num">
                    <button disabled={pendiente} onClick={() => aplicar(s)}>
                      Cambiar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="suave" style={{ fontSize: 12, margin: "8px 0 0" }}>
          Las cantidades son las que aportan las mismas kilocalorías que{" "}
          {Math.round(gramos)} g de {nombreActual}, así que el total de la dieta no
          cambia: solo el reparto de macros.
        </p>
      </td>
    </tr>
  );
}
