"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { asignarAlergenoAFiltro } from "@/app/alergenos/acciones";
import type { Alergeno } from "@/app/alergenos/consultas";

/**
 * Marcar un alérgeno en todo lo que sale de la búsqueda.
 *
 * La fructosa la lleva toda la fruta y no está en el Anexo II: hay que poder
 * filtrar por «Frutas» y marcar las 199 de una vez. De uno en uno no lo hace
 * nadie, y un alérgeno que no se llega a asignar no avisa de nada.
 *
 * Se pide confirmación porque toca muchas filas a la vez y no hay deshacer —lo
 * más parecido es volver a pasarlo en modo quitar—.
 */
export default function AsignarEnBloque({
  catalogo,
  filtro,
  total,
}: {
  catalogo: Alergeno[];
  filtro: { q: string; grupos: string[] };
  total: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [alergeno, setAlergeno] = useState<number | "">("");
  const [quitar, setQuitar] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [trabajando, iniciar] = useTransition();

  const hayFiltro = Boolean(filtro.q || filtro.grupos.length);
  const elegido = catalogo.find((a) => a.id === alergeno);

  function aplicar() {
    if (alergeno === "") return;
    setFallo(null);
    setHecho(null);
    iniciar(async () => {
      try {
        const n = await asignarAlergenoAFiltro(filtro, Number(alergeno), quitar);
        setHecho(
          `${quitar ? "Quitado" : "Marcado"} «${elegido?.nombre}» en ${n} ingrediente${n === 1 ? "" : "s"}.`,
        );
        router.refresh();
      } catch (e) {
        setFallo(e instanceof Error ? e.message : "No se ha podido guardar.");
      }
    });
  }

  if (!abierto)
    return (
      <p style={{ margin: "10px 0 0" }}>
        <button className="enlace" onClick={() => setAbierto(true)}>
          Marcar un alérgeno en estos {total.toLocaleString("es-ES")} ingredientes…
        </button>
      </p>
    );

  return (
    <div className="tarjeta" style={{ marginTop: 12 }}>
      <div className="fila" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14 }}>Marcar en bloque</h2>
        <span style={{ flex: 1 }} />
        <button className="enlace" onClick={() => setAbierto(false)}>
          cerrar
        </button>
      </div>

      <p className="tenue" style={{ fontSize: 13, margin: "0 0 12px", maxWidth: "62ch" }}>
        Se aplica a los <b className="cifra">{total.toLocaleString("es-ES")}</b>{" "}
        ingredientes que salen ahora mismo con esta búsqueda
        {hayFiltro ? "" : " — que ahora mismo es el catálogo entero"}. No los marca
        como revisados: añadir un alérgeno no es haber comprobado la lista.
      </p>

      <div className="fila">
        <select
          value={alergeno}
          onChange={(e) => setAlergeno(e.target.value === "" ? "" : Number(e.target.value))}
          style={{ minWidth: 240 }}
          aria-label="Alérgeno"
        >
          <option value="">Elige un alérgeno…</option>
          {catalogo.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
              {a.estandar ? "" : " (propio)"}
            </option>
          ))}
        </select>

        <label className="opcion" style={{ fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={quitar}
            onChange={(e) => setQuitar(e.target.checked)}
          />
          Quitarlo en vez de ponerlo
        </label>

        <button
          className={quitar ? "peligro" : "principal"}
          onClick={aplicar}
          disabled={trabajando || alergeno === ""}
        >
          {trabajando ? "Aplicando…" : quitar ? "Quitar" : "Marcar"}
        </button>
      </div>

      {!hayFiltro && !quitar && alergeno !== "" && (
        <p className="aviso" style={{ marginTop: 10 }}>
          Cuidado: sin filtro esto marca el catálogo entero. Filtra primero por
          grupo o por nombre.
        </p>
      )}
      {hecho && <p className="mas" style={{ marginTop: 10, fontSize: 13.5 }}>{hecho}</p>}
      {fallo && <p className="aviso" style={{ marginTop: 10 }}>{fallo}</p>}
    </div>
  );
}
