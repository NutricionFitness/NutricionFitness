"use client";

import { useEffect, useRef, useState } from "react";

import { medidaPorDefecto, type Medida } from "@/lib/dominio/medidas";
import { clienteNavegador } from "@/lib/supabase/cliente";

interface Sugerencia {
  id: number;
  nombre: string;
  grupo: string | null;
  kcal_100: number;
  estado: string;
  medidas_caseras: Medida[] | null;
}

/** Quita tildes y baja a minúsculas, igual que la columna `nombre_norm`. */
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Buscador en dos pasos: primero se elige el alimento, después la cantidad.
 *
 * El segundo paso existe por las medidas caseras: nadie pesa un huevo, lo
 * cuenta. Si el ingrediente tiene medidas se puede escribir «2 unidades» y la
 * app traduce a gramos, que es lo único que se guarda.
 */
export default function BuscadorIngrediente({
  onElegir,
  autoFocus = false,
}: {
  onElegir: (ingredienteId: number, gramos: number) => void;
  autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [opciones, setOpciones] = useState<Sugerencia[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<Sugerencia | null>(null);
  const [cantidad, setCantidad] = useState(100);
  const [unidad, setUnidad] = useState<string>("g");
  const ultima = useRef(0);

  useEffect(() => {
    const q = normalizar(texto);
    if (q.length < 2) {
      setOpciones([]);
      return;
    }
    const sello = ++ultima.current;
    const t = setTimeout(async () => {
      setBuscando(true);
      const supabase = clienteNavegador();
      const { data } = await supabase
        .from("ingredientes")
        .select("id, nombre, grupo, kcal_100, estado, medidas_caseras(id, nombre, gramos, owner_id)")
        .ilike("nombre_norm", `%${q}%`)
        .eq("preferente", true)
        .order("nombre")
        .limit(12);
      if (sello !== ultima.current) return; // llegó tarde, ya se ha escrito más
      setOpciones((data ?? []) as unknown as Sugerencia[]);
      setAbierto(true);
      setBuscando(false);
    }, 180);
    return () => clearTimeout(t);
  }, [texto]);

  function elegir(o: Sugerencia) {
    const porDefecto = medidaPorDefecto(o.medidas_caseras);
    setElegido(o);
    setUnidad(porDefecto ? porDefecto.id : "g");
    setCantidad(porDefecto ? 1 : 100);
    setTexto("");
    setOpciones([]);
    setAbierto(false);
  }

  function confirmar() {
    if (!elegido) return;
    const medida = (elegido.medidas_caseras ?? []).find((m) => m.id === unidad);
    const gramos = medida ? cantidad * Number(medida.gramos) : cantidad;
    if (!(gramos > 0)) return;
    onElegir(elegido.id, Math.round(gramos * 100) / 100);
    setElegido(null);
  }

  // ---------------------------------------------- paso 2: cuánto
  if (elegido) {
    const medidas = elegido.medidas_caseras ?? [];
    const medida = medidas.find((m) => m.id === unidad);
    const gramos = medida ? cantidad * Number(medida.gramos) : cantidad;
    return (
      <div className="fila" style={{ marginTop: 8 }}>
        <strong>{elegido.nombre}</strong>
        <input
          type="number"
          min={0}
          step={medida ? 0.5 : 1}
          value={cantidad}
          autoFocus
          onChange={(e) => setCantidad(Number(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && confirmar()}
          style={{ width: 84, textAlign: "right" }}
        />
        {medidas.length > 0 ? (
          <select value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            {medidas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
            <option value="g">gramos</option>
          </select>
        ) : (
          <span className="suave">g</span>
        )}
        {medida && <span className="suave">= {Math.round(gramos)} g</span>}
        <button className="principal" onClick={confirmar}>
          Añadir
        </button>
        <button onClick={() => setElegido(null)}>Cancelar</button>
      </div>
    );
  }

  // ---------------------------------------------- paso 1: cuál
  return (
    <div className="fila" style={{ position: "relative", marginTop: 8 }}>
      <input
        value={texto}
        autoFocus={autoFocus}
        placeholder="Añadir ingrediente…"
        onChange={(e) => setTexto(e.target.value)}
        onFocus={() => opciones.length && setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        style={{ minWidth: 280 }}
      />
      {buscando && <span className="suave" style={{ fontSize: 12 }}>buscando…</span>}

      {abierto && opciones.length > 0 && (
        <ul
          className="tarjeta"
          style={{
            position: "absolute", top: "100%", left: 0, zIndex: 20, margin: "4px 0 0",
            padding: 4, listStyle: "none", minWidth: 420, maxHeight: 320,
            overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.10)",
          }}
        >
          {opciones.map((o) => {
            const medida = medidaPorDefecto(o.medidas_caseras);
            return (
              <li key={o.id}>
                <button
                  style={{
                    width: "100%", textAlign: "left", border: "none",
                    background: "none", padding: "7px 9px", borderRadius: 6,
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegir(o)}
                >
                  {o.nombre}
                  <small className="suave">
                    {" · "}
                    {Math.round(Number(o.kcal_100))} kcal/100 g
                    {o.estado !== "desconocido" ? ` · ${o.estado}` : ""}
                    {medida ? ` · 1 ${medida.nombre} = ${Math.round(Number(medida.gramos))} g` : ""}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
