"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { guardarComoPlantilla } from "@/app/dietas/[id]/acciones";
import { totalesDe } from "@/lib/dominio/totales";
import type { Componente, ModeloEnergia } from "@/lib/motor";

const n0 = (v: number) => Math.round(v).toLocaleString("es-ES");

/** «Opción 1» no es nombre para una plantilla: no dice qué lleva dentro. */
const GENERICO = /^opci[oó]n\s*\d+$/i;

/**
 * Guardar la opción que se está viendo para poder meterla en otra comida.
 *
 * Lo que se guarda es una **foto**: los alimentos con sus gramos y sus reglas
 * de ajuste. No se guardan las kilocalorías —se calculan al mostrarla, porque
 * un ingrediente se puede corregir y porque `modelo_energia` es de la dieta— ni
 * de qué dieta salió: si algún día hace falta esa trazabilidad, va en las notas.
 *
 * Con un nombre que ya existe **no reemplaza sin preguntar**. La base tiene un
 * único `(owner_id, nombre)` y el error se convierte aquí en una segunda
 * pulsación con el aviso delante, que es el patrón de los borrados de la fase 8.
 */
export default function DialogoGuardarPlantilla({
  opcionId,
  opcionNombre,
  comidaNombre,
  estadoDieta,
  componentes,
  modeloEnergia,
  onCerrar,
  onHecho,
}: {
  opcionId: string;
  opcionNombre: string;
  comidaNombre: string;
  estadoDieta: "crudo" | "cocido" | "mixto";
  /** Los de la opción que se está guardando, para enseñar lo que se guarda. */
  componentes: Componente[];
  modeloEnergia: ModeloEnergia;
  onCerrar: () => void;
  onHecho: (nombre: string) => void;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [nombre, setNombre] = useState(
    GENERICO.test(opcionNombre.trim()) ? comidaNombre : opcionNombre,
  );
  const [comida, setComida] = useState(comidaNombre);
  const [notas, setNotas] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  const [chocaCon, setChocaCon] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  useEffect(() => {
    const d = dialogo.current;
    if (d && !d.open) d.showModal();
  }, []);

  const t = totalesDe(componentes, modeloEnergia);

  function guardar(reemplazar: boolean) {
    setFallo(null);
    iniciar(async () => {
      const r = await guardarComoPlantilla({
        opcionId,
        nombre,
        comidaSugerida: comida,
        estadoCantidades: estadoDieta,
        notas,
        reemplazar,
      });
      if (r.yaExiste) {
        setChocaCon(nombre.trim());
        return;
      }
      if (r.error) {
        setFallo(r.error);
        return;
      }
      onHecho(nombre.trim());
    });
  }

  return (
    <dialog ref={dialogo} className="guardar-plantilla" onClose={onCerrar}>
      <header>
        <h3>Guardar «{opcionNombre}» como plantilla</h3>
        <button type="button" className="enlace" onClick={() => dialogo.current?.close()}>
          cerrar
        </button>
      </header>

      <p className="que-se-guarda">
        Se guardan {componentes.length}{" "}
        {componentes.length === 1 ? "alimento" : "alimentos"} con sus cantidades:{" "}
        <strong>
          {n0(t.energia)} kcal · {n0(t.pct.prot)}/{n0(t.pct.hc)}/{n0(t.pct.grasa)}
        </strong>
        . <span className="tenue">Las kcal no se guardan: se calculan al usarla.</span>
      </p>

      <label className="campo">
        <span>Nombre</span>
        <input
          autoFocus
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            setChocaCon(null);
          }}
          disabled={pendiente}
        />
      </label>

      <label className="campo">
        <span>Para qué comida</span>
        <input
          value={comida}
          onChange={(e) => setComida(e.target.value)}
          disabled={pendiente}
          placeholder="Desayuno, Cena…"
        />
        <span className="tenue">
          Solo ordena el selector: las de esa comida salen arriba, pero se ven todas.
        </span>
      </label>

      <label className="campo">
        <span>Notas</span>
        <input
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          disabled={pendiente}
          placeholder="Opcional"
        />
      </label>

      <p className="tenue">
        Se guarda <strong>{estadoDieta === "mixto" ? "en mixto" : `en ${estadoDieta}`}</strong>,
        como esta dieta. Al importarla en una dieta con otro estado se avisa: los mismos
        gramos significan cantidades distintas y no se convierten.
      </p>

      {chocaCon && (
        <div className="caja-aviso">
          Ya tienes una plantilla que se llama «{chocaCon}». Cámbiale el nombre, o
          reemplázala: la de antes se pierde.
        </div>
      )}
      {fallo && <p className="caja-peligro">{fallo}</p>}

      <footer>
        <button type="button" disabled={pendiente} onClick={() => dialogo.current?.close()}>
          Cancelar
        </button>
        {chocaCon && (
          <button
            type="button"
            className="peligro"
            disabled={pendiente}
            onClick={() => guardar(true)}
          >
            {pendiente ? "Reemplazando…" : "Reemplazarla"}
          </button>
        )}
        <button
          type="button"
          className="principal"
          disabled={pendiente || !nombre.trim() || Boolean(chocaCon)}
          onClick={() => guardar(false)}
        >
          {pendiente ? "Guardando…" : "Guardar"}
        </button>
      </footer>
    </dialog>
  );
}
