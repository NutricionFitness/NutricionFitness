"use client";

import { useEffect, useState, useTransition } from "react";

import { buscarSustitutos, cambiarIngrediente } from "@/app/dietas/[id]/acciones";
import { clienteNavegador } from "@/lib/supabase/cliente";
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
  alergias,
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
  /** Los alérgenos de la persona de esta dieta. */
  alergias?: Set<number>;
  /** Si viene, se buscan los cambios que más acercan a ese reparto. */
  objetivo?: { macrosDieta: Macros; energiaDieta: number; objetivoPct: Partial<Macros> };
  onCerrar: () => void;
  onHecho: () => void;
}) {
  /*
   * Los dos interruptores arrancan según para qué se haya abierto el panel.
   *
   * Sin reparto pedido, la pregunta es «no tengo esto, ¿por qué lo cambio?», y
   * ahí lo que se quiere es algo parecido: mismo grupo.
   *
   * Con reparto pedido, la pregunta es la contraria —«no llego al 35% de
   * proteína»— y dentro del mismo grupo casi nunca hay respuesta: cambiar una
   * merluza por un pollo a las mismas kilocalorías no mueve el reparto de la
   * dieta ni medio punto. Lo que lo mueve es cruzar de grupo, así que se
   * empieza con el filtro quitado.
   */
  const [soloMismoGrupo, setSoloMismoGrupo] = useState(!objetivo);
  const [dirigido, setDirigido] = useState(Boolean(objetivo));
  const [propuestas, setPropuestas] = useState<Sustitucion[] | null>(null);
  const [conAlergeno, setConAlergeno] = useState<Set<number>>(new Set());
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
    }).then(async (r) => {
      if (!vigente) return;
      setPropuestas(r);
      setConAlergeno(new Set());

      // Los alérgenos de los candidatos se piden aparte: así `buscarSustitutos`
      // sigue siendo lo que era y el dominio no se entera de las alergias.
      if (!alergias?.size || !r.length) return;
      const { data } = await clienteNavegador()
        .from("ingrediente_alergenos")
        .select("ingrediente_id, alergeno_id")
        .in("ingrediente_id", r.map((s) => s.candidato.id))
        .in("alergeno_id", [...alergias]);
      if (!vigente) return;
      setConAlergeno(
        new Set(
          ((data ?? []) as { ingrediente_id: number }[]).map((f) =>
            Number(f.ingrediente_id),
          ),
        ),
      );
    });
    return () => {
      vigente = false;
    };
  }, [ingredienteId, gramos, grupo, soloMismoGrupo, dirigido, objetivo, alergias]);

  function aplicar(s: Sustitucion) {
    iniciar(() =>
      cambiarIngrediente(componenteId, s.candidato.id, s.gramos, dietaId).then(onHecho),
    );
  }

  return (
    <tr>
      <td colSpan={9} className="sustitucion">
        <div className="fila">
          <strong>Cambiar {nombreActual}</strong>
          <span style={{ flex: 1 }} />
          <button className="enlace" onClick={onCerrar}>
            cerrar
          </button>
        </div>

        <div className="fila" style={{ margin: "10px 0", fontSize: 13.5, gap: 18 }}>
          <label className="opcion" style={{ fontSize: 13.5 }}>
            <input
              type="checkbox"
              checked={soloMismoGrupo}
              onChange={(e) => setSoloMismoGrupo(e.target.checked)}
            />
            Solo del mismo grupo
          </label>
          {/* La opción se enseña siempre, apagada cuando no puede funcionar.
              Antes aparecía y desaparecía según un interruptor que está en otro
              panel, sin decirlo en ninguna parte: se veía como que iba y venía
              sola. Vale más un interruptor apagado con su motivo al lado. */}
          <label
            className="opcion"
            style={{ fontSize: 13.5, opacity: objetivo ? 1 : 0.55 }}
          >
            <input
              type="checkbox"
              disabled={!objetivo}
              checked={dirigido && Boolean(objetivo)}
              onChange={(e) => setDirigido(e.target.checked)}
            />
            Los que más acercan al reparto pedido
          </label>
          {!objetivo && (
            <span className="tenue" style={{ fontSize: 12.5 }}>
              Para esto, pide un reparto distinto del actual en «Ajustar kcal».
            </span>
          )}
        </div>

        {propuestas === null ? (
          <p className="suave" style={{ margin: 0 }}>Buscando…</p>
        ) : propuestas.length === 0 ? (
          <p className="suave" style={{ margin: 0 }}>
            {dirigido
              ? soloMismoGrupo
                ? "Ningún cambio dentro del mismo grupo acerca al reparto pedido, y es lo normal: a las mismas kilocalorías, dos alimentos del mismo grupo aportan casi lo mismo. Desmarca «solo del mismo grupo»."
                : "Ningún cambio de este componente acerca al reparto pedido. Prueba con otro: el que más pesa en la dieta suele ser el que más la mueve."
              : soloMismoGrupo
                ? "No hay sustitutos razonables en este grupo. Prueba a desmarcar «solo del mismo grupo»."
                : "No hay sustitutos razonables: ninguno cuadra en energía sin irse a una cantidad que nadie se comería."}
          </p>
        ) : (
          <div className="tabla">
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
                    {conAlergeno.has(s.candidato.id) && (
                      <span className="chip alergia fuerte" style={{ marginLeft: 6 }}>
                        POSIBLE ALERGIA
                      </span>
                    )}
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
          </div>
        )}

        <p className="tenue" style={{ fontSize: 12, margin: "10px 0 0" }}>
          Las cantidades son las que aportan las mismas kilocalorías que{" "}
          {Math.round(gramos)} g de {nombreActual}, así que el total de la dieta no
          cambia: solo el reparto de macros.
        </p>
      </td>
    </tr>
  );
}
