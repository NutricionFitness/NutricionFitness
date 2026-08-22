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
  ingrediente_alergenos: { alergeno_id: number }[] | null;
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
  alergias,
}: {
  onElegir: (ingredienteId: number, gramos: number) => void;
  autoFocus?: boolean;
  /** Los alérgenos de la persona de esta dieta, para avisar ANTES de añadirlo. */
  alergias?: Set<number>;
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
        .select(
          "id, nombre, grupo, kcal_100, estado, " +
            "medidas_caseras(id, nombre, gramos, owner_id), " +
            "ingrediente_alergenos(alergeno_id)",
        )
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

  /** ¿Este ingrediente lleva algo a lo que la persona es alérgica? */
  const choca = (o: Sugerencia) =>
    Boolean(alergias?.size) &&
    (o.ingrediente_alergenos ?? []).some((a) => alergias!.has(Number(a.alergeno_id)));

  // ---------------------------------------------- paso 2: cuánto
  if (elegido) {
    const medidas = elegido.medidas_caseras ?? [];
    const medida = medidas.find((m) => m.id === unidad);
    const gramos = medida ? cantidad * Number(medida.gramos) : cantidad;
    return (
      <div className="buscador">
        <strong style={{ fontSize: 14 }}>{elegido.nombre}</strong>
        {choca(elegido) && (
          <span className="chip alergia fuerte">POSIBLE ALERGIA</span>
        )}
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
        {medida && (
          <span className="tenue cifra" style={{ fontSize: 13 }}>
            = {Math.round(gramos)} g
          </span>
        )}
        <button className="principal" onClick={confirmar}>
          Añadir
        </button>
        <button onClick={() => setElegido(null)}>Cancelar</button>
      </div>
    );
  }

  // ---------------------------------------------- paso 1: cuál
  return (
    <div className="buscador">
      <input
        value={texto}
        autoFocus={autoFocus}
        placeholder="Añadir ingrediente…"
        onChange={(e) => setTexto(e.target.value)}
        onFocus={() => opciones.length && setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        style={{ minWidth: 260, flex: "1 1 260px", maxWidth: 420 }}
      />
      {buscando && <span className="tenue" style={{ fontSize: 12 }}>buscando…</span>}

      {abierto && opciones.length > 0 && (
        <ul className="sugerencias">
          {opciones.map((o) => {
            const medida = medidaPorDefecto(o.medidas_caseras);
            return (
              <li key={o.id}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegir(o)}
                >
                  {o.nombre}
                  {choca(o) && (
                    <span className="chip alergia fuerte" style={{ marginLeft: 8 }}>
                      POSIBLE ALERGIA
                    </span>
                  )}
                  <small className="tenue">
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
