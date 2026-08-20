"use client";

import { useEffect, useRef, useState } from "react";

import { clienteNavegador } from "@/lib/supabase/cliente";

interface Sugerencia {
  id: number;
  nombre: string;
  grupo: string | null;
  kcal_100: number;
  estado: string;
}

/** Quita tildes y baja a minúsculas, igual que la columna `nombre_norm` de la
 *  base, para que buscar «platano» encuentre «plátano». */
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export default function BuscadorIngrediente({
  onElegir,
  autoFocus = false,
}: {
  onElegir: (ingredienteId: number, gramos: number) => void;
  autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [gramos, setGramos] = useState(100);
  const [opciones, setOpciones] = useState<Sugerencia[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);
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
        .select("id, nombre, grupo, kcal_100, estado")
        .ilike("nombre_norm", `%${q}%`)
        .eq("preferente", true)
        .order("nombre")
        .limit(12);
      // Si mientras tanto se ha escrito más, esta respuesta ya no vale.
      if (sello !== ultima.current) return;
      setOpciones((data ?? []) as Sugerencia[]);
      setAbierto(true);
      setBuscando(false);
    }, 180);
    return () => clearTimeout(t);
  }, [texto]);

  return (
    <div className="fila" style={{ position: "relative", marginTop: 8 }}>
      <input
        value={texto}
        autoFocus={autoFocus}
        placeholder="Añadir ingrediente…"
        onChange={(e) => setTexto(e.target.value)}
        onFocus={() => opciones.length && setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        style={{ minWidth: 260 }}
      />
      <input
        type="number"
        value={gramos}
        min={1}
        onChange={(e) => setGramos(Number(e.target.value))}
        style={{ width: 84, textAlign: "right" }}
      />
      <span className="suave" style={{ fontSize: 13 }}>g</span>
      {buscando && <span className="suave" style={{ fontSize: 12 }}>buscando…</span>}

      {abierto && opciones.length > 0 && (
        <ul
          className="tarjeta"
          style={{
            position: "absolute", top: "100%", left: 0, zIndex: 20, margin: "4px 0 0",
            padding: 4, listStyle: "none", minWidth: 380, maxHeight: 320,
            overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.10)",
          }}
        >
          {opciones.map((o) => (
            <li key={o.id}>
              <button
                style={{
                  width: "100%", textAlign: "left", border: "none",
                  background: "none", padding: "7px 9px", borderRadius: 6,
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onElegir(o.id, gramos);
                  setTexto("");
                  setOpciones([]);
                  setAbierto(false);
                }}
              >
                {o.nombre}
                <small className="suave">
                  {" · "}
                  {Math.round(Number(o.kcal_100))} kcal/100 g
                  {o.estado !== "desconocido" ? ` · ${o.estado}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
