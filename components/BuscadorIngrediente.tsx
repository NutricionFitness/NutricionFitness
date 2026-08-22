"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { crearIngredienteYDevolver } from "@/app/ingredientes/acciones";
import {
  kcalAtwater,
  nombreAlergeno,
  type PropuestaEscaneo,
} from "@/app/ingredientes/tipos";
import { medidaPorDefecto, type Medida } from "@/lib/dominio/medidas";
import { clienteNavegador } from "@/lib/supabase/cliente";
import AltaPorCodigo, { AvisosEscaneo } from "./AltaPorCodigo";

interface Sugerencia {
  id: number;
  nombre: string;
  grupo: string | null;
  kcal_100: number;
  estado: string;
  medidas_caseras: Medida[] | null;
  ingrediente_alergenos: { alergeno_id: number }[] | null;
}

/** Las columnas de una sugerencia. Una sola vez: se piden desde dos sitios. */
const COLUMNAS =
  "id, nombre, grupo, kcal_100, estado, " +
  "medidas_caseras(id, nombre, gramos, owner_id), " +
  "ingrediente_alergenos(alergeno_id)";

/** Quita tildes y baja a minúsculas, igual que la columna `nombre_norm`. */
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/**
 * Buscador en dos pasos: primero se elige el alimento, después la cantidad.
 *
 * El segundo paso existe por las medidas caseras: nadie pesa un huevo, lo
 * cuenta. Si el ingrediente tiene medidas se puede escribir «2 unidades» y la
 * app traduce a gramos, que es lo único que se guarda.
 *
 * Desde la fase 14 hay un tercer camino para llegar al alimento: el código de
 * barras. Es el que compensa cuando estás montando la dieta con el envase en la
 * mano, porque un producto de marca no está en BEDCA y buscarlo por nombre no
 * lleva a ninguna parte.
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

  // --- alta por código de barras
  const [propuesta, setPropuesta] = useState<PropuestaEscaneo | null>(null);
  const [falloAlta, setFalloAlta] = useState<string | null>(null);
  const [dandoDeAlta, iniciarAlta] = useTransition();

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
        .select(COLUMNAS)
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
    setPropuesta(null);
  }

  /**
   * Carga un ingrediente por su identificador y salta al paso de la cantidad.
   *
   * Hace falta porque tanto el escaneo de algo ya catalogado como el alta
   * recién hecha devuelven solo un id, y el segundo paso necesita las medidas
   * caseras y los alérgenos para poder avisar.
   */
  async function irACantidad(id: number) {
    const supabase = clienteNavegador();
    const { data } = await supabase.from("ingredientes").select(COLUMNAS).eq("id", id).single();
    if (data) elegir(data as unknown as Sugerencia);
  }

  function darDeAlta(p: PropuestaEscaneo) {
    setFalloAlta(null);
    iniciarAlta(async () => {
      try {
        const { id } = await crearIngredienteYDevolver(
          {
            nombre: p.nombre,
            grupo: p.grupo,
            estado: p.estado,
            prot_100: p.prot_100,
            hc_100: p.hc_100,
            grasa_100: p.grasa_100,
            fibra_100: p.fibra_100,
            alcohol_100: p.alcohol_100,
            agua_100: p.agua_100,
            ags_100: p.ags_100,
            sodio_100: p.sodio_100,
            porcion_comestible: p.porcion_comestible,
            notas: p.notas,
          },
          {
            codigo_barras: p.codigo_barras,
            kcal_ref: p.kcal_ref,
            alergenos: p.alergenos,
            trazas: p.trazas,
          },
        );
        await irACantidad(id);
      } catch (e) {
        setFalloAlta(e instanceof Error ? e.message : "No se ha podido dar de alta.");
      }
    });
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

  // ---------------------------------- lo que ha traído el código de barras
  if (propuesta) {
    const kcal = kcalAtwater(propuesta);
    return (
      <div className="propuesta-escaneo">
        <AvisosEscaneo avisos={propuesta.avisos} />

        <div className="cabeza">
          <strong>{propuesta.nombre || "(la ficha no tiene nombre)"}</strong>
          <span className="cifra tenue">{Math.round(kcal)} kcal/100 g</span>
        </div>

        <p className="cifra macros">
          <span>{propuesta.prot_100} g proteína</span>
          <span>{propuesta.hc_100} g hidratos</span>
          <span>{propuesta.grasa_100} g grasa</span>
          {propuesta.fibra_100 > 0 && <span>{propuesta.fibra_100} g fibra</span>}
        </p>

        {(propuesta.alergenos.length > 0 || propuesta.trazas.length > 0) && (
          <p className="tenue" style={{ fontSize: 12.5, margin: 0 }}>
            La etiqueta declara:{" "}
            {propuesta.alergenos.map(nombreAlergeno).join(", ")}
            {propuesta.trazas.length > 0 &&
              `${propuesta.alergenos.length ? "; " : ""}trazas de ${propuesta.trazas
                .map(nombreAlergeno)
                .join(", ")}`}
            .
          </p>
        )}

        {falloAlta && <p className="aviso">{falloAlta}</p>}

        <div className="fila">
          <button className="principal" onClick={() => darDeAlta(propuesta)} disabled={dandoDeAlta}>
            {dandoDeAlta ? "Dando de alta…" : "Dar de alta y añadir"}
          </button>
          <Link className="enlace" href={`/ingredientes/nuevo?ean=${propuesta.codigo_barras}`}>
            Revisar la ficha entera antes
          </Link>
          <button type="button" onClick={() => setPropuesta(null)} disabled={dandoDeAlta}>
            Cancelar
          </button>
        </div>

        <p className="tenue" style={{ fontSize: 12, margin: 0 }}>
          Entra sin revisar: lo dice la etiqueta según Open Food Facts, no lo has
          comprobado tú. La ficha lo dirá hasta que lo mires.
        </p>
      </div>
    );
  }

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
        style={{ minWidth: 220, flex: "1 1 220px", maxWidth: 420 }}
      />
      {buscando && <span className="tenue" style={{ fontSize: 12 }}>buscando…</span>}

      <AltaPorCodigo
        etiqueta="Escanear"
        onEnCatalogo={(id) => void irACantidad(id)}
        onPropuesta={setPropuesta}
      />

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
