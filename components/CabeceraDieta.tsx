"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  actualizarDieta,
  borrarDieta,
  duplicarDieta,
} from "@/app/dietas/[id]/acciones";
import BotonPeligroso from "./BotonPeligroso";

const ESTADOS = [
  ["crudo", "en crudo"],
  ["cocido", "ya cocinadas"],
  ["mixto", "mezcladas"],
] as const;

/**
 * Nombre, estado de las cantidades y las acciones de la dieta.
 *
 * El estado de las cantidades es editable aquí porque el editor avisa cuando no
 * cuadra con los ingredientes: un aviso que no se puede resolver desde donde
 * aparece es un aviso inútil.
 */
export default function CabeceraDieta({
  dieta,
  nVersiones,
}: {
  dieta: {
    id: string;
    nombre: string;
    estado_cantidades: string;
    version: number;
    dieta_padre_id: string | null;
    persona_id: string | null;
  };
  nVersiones: number;
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(dieta.nombre);
  const [pendiente, iniciar] = useTransition();

  function guardar() {
    iniciar(() => actualizarDieta(dieta.id, { nombre: nombre.trim() }).then(() => setEditando(false)));
  }

  return (
    <>
      {editando ? (
        <div className="fila" style={{ margin: "4px 0 2px" }}>
          <input
            value={nombre}
            autoFocus
            onChange={(e) => setNombre(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") guardar();
              if (e.key === "Escape") setEditando(false);
            }}
            style={{ fontSize: 20, minWidth: 320 }}
          />
          <button className="principal" onClick={guardar} disabled={pendiente || !nombre.trim()}>
            Guardar
          </button>
          <button onClick={() => { setNombre(dieta.nombre); setEditando(false); }}>
            Cancelar
          </button>
        </div>
      ) : (
        <h1 style={{ marginBottom: 2 }}>
          {dieta.nombre}{" "}
          <button
            className="enlace"
            style={{ fontSize: 13.5, fontWeight: 400 }}
            onClick={() => setEditando(true)}
          >
            renombrar
          </button>
        </h1>
      )}

      <div className="fila sub" style={{ gap: 12, marginTop: 8 }}>
        <span className="chip">
          Versión {dieta.version}
          {dieta.dieta_padre_id ? " · de un ajuste" : ""}
        </span>

        <span className="fila" style={{ gap: 6, fontSize: 13.5 }}>
          Cantidades
          <select
            value={dieta.estado_cantidades}
            disabled={pendiente}
            onChange={(e) =>
              iniciar(() =>
                actualizarDieta(dieta.id, {
                  estado_cantidades: e.target.value as "crudo" | "cocido" | "mixto",
                }),
              )
            }
          >
            {ESTADOS.map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </span>

        <span className="fila" style={{ gap: 12, fontSize: 13.5 }}>
          <Link href={`/dietas/${dieta.id}/historial`}>historial</Link>
          <Link href={`/dietas/${dieta.id}/imprimir`}>imprimir o PDF</Link>

          <button
            className="enlace"
            disabled={pendiente}
            onClick={() => iniciar(() => duplicarDieta(dieta.id))}
          >
            duplicar
          </button>
        </span>

        <BotonPeligroso
          etiqueta="borrar"
          aviso={
            nVersiones > 1
              ? `Se borra solo esta versión. Las otras ${nVersiones - 1} se conservan.`
              : "Esta dieta se borra con sus comidas y componentes."
          }
          onConfirmar={() => borrarDieta(dieta.id, dieta.persona_id)}
        />
      </div>
    </>
  );
}
