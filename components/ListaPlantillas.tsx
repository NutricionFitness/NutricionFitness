"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { actualizarPlantilla, borrarPlantilla } from "@/app/plantillas/acciones";
import type { PlantillaGuardada } from "@/app/plantillas/tipos";
import { aComponentePlantilla } from "@/lib/dominio/plantillas";
import { totalesDe } from "@/lib/dominio/totales";
import BotonPeligroso from "./BotonPeligroso";

const n0 = (v: number) => Math.round(v).toLocaleString("es-ES");

/** Sin tildes y en minúsculas: buscar «platano» tiene que encontrar «plátano». */
const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * Las plantillas guardadas, con buscador.
 *
 * Se **gestionan**, no se editan: nombre, para qué comida y notas, y quitarlas.
 * Para cambiar lo que llevan dentro se importa la plantilla en una dieta, se
 * toca allí y se vuelve a guardar reemplazando. Es lo que mantiene en pie «una
 * plantilla es una foto»: los alimentos solo se tocan donde hay una referencia
 * contra la que cuadrar.
 *
 * La búsqueda mira también **los alimentos**, que es como se busca una
 * plantilla de verdad: uno se acuerda de que llevaba boniato antes que de cómo
 * la llamó.
 *
 * Todo se filtra aquí, sin volver al servidor: son las plantillas de una
 * cuenta, y ya han llegado enteras.
 */
export default function ListaPlantillas({ plantillas }: { plantillas: PlantillaGuardada[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState({ nombre: "", comida: "", notas: "" });
  const [fallo, setFallo] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const q = plano(busca.trim());
  const lista = q
    ? plantillas.filter((p) =>
        plano(
          [p.nombre, p.comidaSugerida ?? "", p.notas ?? ""]
            .concat(p.componentes.map((c) => c.ingredientes?.nombre ?? ""))
            .join(" "),
        ).includes(q),
      )
    : plantillas;

  function empezarAEditar(p: PlantillaGuardada) {
    setFallo(null);
    setEditando(p.id);
    setBorrador({
      nombre: p.nombre,
      comida: p.comidaSugerida ?? "",
      notas: p.notas ?? "",
    });
  }

  function guardar(id: string) {
    setFallo(null);
    iniciar(async () => {
      const r = await actualizarPlantilla(id, {
        nombre: borrador.nombre,
        comidaSugerida: borrador.comida,
        notas: borrador.notas,
      });
      if (r.error) return setFallo(r.error);
      setEditando(null);
      router.refresh();
    });
  }

  if (plantillas.length === 0)
    return (
      <p className="vacio">
        Todavía no has guardado ninguna plantilla. Se guardan desde cualquier opción
        de una comida, con «guardar esta como plantilla».
      </p>
    );

  return (
    <>
      <div className="fila" style={{ margin: "16px 0 14px" }}>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nombre, comida o alimento…"
          aria-label="Buscar plantillas"
          style={{ width: "min(360px, 100%)" }}
        />
        <span className="tenue" style={{ fontSize: 12.5 }}>
          {lista.length === plantillas.length
            ? `${plantillas.length} ${plantillas.length === 1 ? "plantilla" : "plantillas"}`
            : `${lista.length} de ${plantillas.length}`}
        </span>
      </div>

      {fallo && <p className="aviso">{fallo}</p>}

      {lista.length === 0 ? (
        <p className="vacio">Ninguna coincide con «{busca}».</p>
      ) : (
        <ul className="lista-guardadas">
          {lista.map((p) => {
            const comps = p.componentes
              .filter((c) => c.ingredientes)
              .map((c) => aComponentePlantilla(c, p.comidaSugerida ?? ""));
            const t = totalesDe(comps);
            const abiertaEsta = abierta === p.id;

            return (
              <li key={p.id}>
                {editando === p.id ? (
                  <div className="editor">
                    <label className="campo">
                      <span>Nombre</span>
                      <input
                        value={borrador.nombre}
                        autoFocus
                        onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })}
                      />
                    </label>
                    <label className="campo">
                      <span>Para qué comida</span>
                      <input
                        value={borrador.comida}
                        placeholder="Desayuno, Cena…"
                        onChange={(e) => setBorrador({ ...borrador, comida: e.target.value })}
                      />
                    </label>
                    <label className="campo">
                      <span>Notas</span>
                      <input
                        value={borrador.notas}
                        placeholder="Opcional"
                        onChange={(e) => setBorrador({ ...borrador, notas: e.target.value })}
                      />
                    </label>
                    <div className="fila">
                      <button
                        className="principal"
                        disabled={pendiente || !borrador.nombre.trim()}
                        onClick={() => guardar(p.id)}
                      >
                        {pendiente ? "Guardando…" : "Guardar"}
                      </button>
                      <button disabled={pendiente} onClick={() => setEditando(null)}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="cabeza">
                      <button
                        type="button"
                        className="nombre"
                        aria-expanded={abiertaEsta}
                        onClick={() => setAbierta(abiertaEsta ? null : p.id)}
                        title={abiertaEsta ? "Ocultar lo que lleva" : "Ver lo que lleva"}
                      >
                        <span aria-hidden className="flecha">
                          {abiertaEsta ? "▾" : "▸"}
                        </span>
                        <strong>{p.nombre}</strong>
                      </button>
                      {p.comidaSugerida && <span className="chip">{p.comidaSugerida}</span>}
                      <span className="chip" title="Qué significan sus gramos">
                        {p.estadoCantidades}
                      </span>
                      <span className="cifras">
                        {n0(t.energia)} kcal · {n0(t.pct.prot)}/{n0(t.pct.hc)}/
                        {n0(t.pct.grasa)}
                        <span className="tenue">
                          {" "}
                          · {p.componentes.length}{" "}
                          {p.componentes.length === 1 ? "alimento" : "alimentos"}
                        </span>
                      </span>
                      <span className="acciones">
                        <button className="enlace" onClick={() => empezarAEditar(p)}>
                          editar
                        </button>
                        <BotonPeligroso
                          clase="enlace peligroso"
                          etiqueta="quitar"
                          aviso={`Se borra «${p.nombre}». Las opciones que ya salieron de ella se quedan como están.`}
                          confirmacion="Sí, quitarla"
                          onConfirmar={async () => {
                            const r = await borrarPlantilla(p.id);
                            if (r.error) setFallo(r.error);
                            else router.refresh();
                          }}
                        />
                      </span>
                    </div>

                    {p.notas && <p className="notas">{p.notas}</p>}

                    {abiertaEsta && (
                      <ul className="dentro">
                        {p.componentes.map((c) => (
                          <li key={c.id}>
                            <span>{c.ingredientes?.nombre ?? "(ingrediente borrado)"}</span>
                            <b className="cifra">{Math.round(Number(c.gramos))} g</b>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
