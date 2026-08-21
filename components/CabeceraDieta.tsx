"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  actualizarDieta,
  borrarDieta,
  duplicarDieta,
} from "@/app/dietas/[id]/acciones";
import BotonPeligroso from "./BotonPeligroso";
import { IconoAyuda, IconoCopiar, IconoPapelera } from "./Iconos";

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
  const [ayuda, setAyuda] = useState(false);
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
          <button
            className="icono ayuda-boton"
            aria-expanded={ayuda}
            title="Qué hace esto"
            aria-label="Qué hace el estado de las cantidades"
            onClick={() => setAyuda(!ayuda)}
          >
            <IconoAyuda />
          </button>
        </span>

        <span className="fila" style={{ gap: 12, fontSize: 13.5 }}>
          <Link href={`/dietas/${dieta.id}/historial`}>historial</Link>
          <Link href={`/dietas/${dieta.id}/imprimir`}>imprimir o PDF</Link>
        </span>

        <span className="acciones">
          <button
            className="icono"
            title="Duplicar la dieta"
            aria-label="Duplicar la dieta"
            disabled={pendiente}
            onClick={() => iniciar(() => duplicarDieta(dieta.id))}
          >
            <IconoCopiar />
          </button>

          <BotonPeligroso
            clase="icono quitar"
            titulo="Eliminar la dieta"
            etiqueta={<IconoPapelera />}
            aviso={
              nVersiones > 1
                ? `Se borra solo esta versión. Las otras ${nVersiones - 1} se conservan.`
                : "Esta dieta se borra con sus comidas y componentes."
            }
            onConfirmar={() => borrarDieta(dieta.id, dieta.persona_id)}
          />
        </span>
      </div>

      {ayuda && (
        <div className="ayuda">
          <h3>Esto es una etiqueta, no una conversión</h3>
          <p>
            Dice qué significan los gramos que has escrito. No los toca: cambiarlo
            no mueve ni un gramo ni una kilocaloría.
          </p>
          <p>
            Sirve para avisarte cuando en la misma dieta hay alimentos crudos y
            alimentos ya cocinados, porque entonces los gramos no significan lo mismo
            en unas filas que en otras. Elige <strong>mezcladas</strong> si es a
            propósito y quieres que deje de avisar.
          </p>
          <p>
            Para convertir de verdad, usa el enlace{" "}
            <strong>«→ pasar a cocido»</strong> que aparece en la fila del
            ingrediente: ahí sí cambian los gramos, con el factor que sale del agua
            que declara BEDCA. Solo aparece en los alimentos que tienen pareja
            crudo/cocido en la base, que son unos cuantos, no todos.
          </p>
          <button className="enlace" onClick={() => setAyuda(false)}>
            Entendido
          </button>
        </div>
      )}
    </>
  );
}
