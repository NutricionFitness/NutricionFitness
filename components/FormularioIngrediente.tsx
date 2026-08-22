"use client";

import { useState, useTransition } from "react";

import { actualizarIngrediente, crearIngrediente } from "@/app/ingredientes/acciones";
import {
  ESTADOS,
  ETIQUETA_ESTADO,
  kcalAtwater,
  type DatosIngrediente,
  type Estado,
} from "@/app/ingredientes/tipos";
import SelectorGrupoUnico from "./SelectorGrupoUnico";

/**
 * Los números se guardan como texto mientras se escriben.
 *
 * Con `number` en el estado, teclear «0.5» pasa por «0.» —que no es un número— y
 * el campo se te queda en 0 a mitad de palabra. Se convierten al guardar.
 */
type Campos = {
  [K in keyof DatosIngrediente]: DatosIngrediente[K] extends number | null
    ? string
    : DatosIngrediente[K];
};

/** Las claves que son números: las únicas que pinta `campoNumero`. */
type ClaveNumero =
  | "prot_100"
  | "hc_100"
  | "grasa_100"
  | "fibra_100"
  | "alcohol_100"
  | "agua_100"
  | "ags_100"
  | "sodio_100"
  | "porcion_comestible";

const texto = (v: number | null) => (v === null || v === undefined ? "" : String(v));

const VACIO: Campos = {
  nombre: "",
  grupo: null,
  estado: "desconocido",
  prot_100: "0",
  hc_100: "0",
  grasa_100: "0",
  fibra_100: "0",
  alcohol_100: "0",
  agua_100: "",
  ags_100: "",
  sodio_100: "",
  porcion_comestible: "",
  notas: null,
};

/** Un número obligatorio: vacío cuenta como cero. */
const obligatorio = (s: string) => {
  const v = Number(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

/** Un número opcional: vacío es «no lo sé», que no es lo mismo que cero. */
const opcional = (s: string) => {
  if (String(s).trim() === "") return null;
  const v = Number(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

export default function FormularioIngrediente({
  grupos,
  inicial,
  id,
  onCancelar,
}: {
  grupos: string[];
  inicial?: DatosIngrediente;
  /** Si viene, se corrige ese ingrediente; si no, se crea uno nuevo. */
  id?: number;
  onCancelar?: () => void;
}) {
  const [c, setC] = useState<Campos>(() =>
    inicial
      ? {
          nombre: inicial.nombre,
          grupo: inicial.grupo,
          estado: inicial.estado,
          prot_100: texto(inicial.prot_100),
          hc_100: texto(inicial.hc_100),
          grasa_100: texto(inicial.grasa_100),
          fibra_100: texto(inicial.fibra_100),
          alcohol_100: texto(inicial.alcohol_100),
          agua_100: texto(inicial.agua_100),
          ags_100: texto(inicial.ags_100),
          sodio_100: texto(inicial.sodio_100),
          porcion_comestible: texto(inicial.porcion_comestible),
          notas: inicial.notas,
        }
      : VACIO,
  );
  const [otros, setOtros] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardando, iniciar] = useTransition();

  const pon = <K extends keyof Campos>(k: K, v: Campos[K]) =>
    setC((antes) => ({ ...antes, [k]: v }) as Campos);

  // Las kcal se calculan aquí igual que en la base, para verlas mientras se
  // escribe. No se envían: la columna es generada.
  const kcal = kcalAtwater({
    prot_100: obligatorio(c.prot_100) || 0,
    hc_100: obligatorio(c.hc_100) || 0,
    grasa_100: obligatorio(c.grasa_100) || 0,
    alcohol_100: obligatorio(c.alcohol_100) || 0,
  });

  function guardar() {
    setFallo(null);

    const datos: DatosIngrediente = {
      nombre: c.nombre.trim(),
      grupo: c.grupo,
      estado: c.estado,
      prot_100: obligatorio(c.prot_100),
      hc_100: obligatorio(c.hc_100),
      grasa_100: obligatorio(c.grasa_100),
      fibra_100: obligatorio(c.fibra_100),
      alcohol_100: obligatorio(c.alcohol_100),
      agua_100: opcional(c.agua_100),
      ags_100: opcional(c.ags_100),
      sodio_100: opcional(c.sodio_100),
      porcion_comestible: opcional(c.porcion_comestible),
      notas: c.notas,
    };

    if (!datos.nombre) return setFallo("Ponle un nombre al ingrediente.");

    const numeros = [
      ["proteínas", datos.prot_100],
      ["hidratos", datos.hc_100],
      ["grasa", datos.grasa_100],
      ["fibra", datos.fibra_100],
      ["alcohol", datos.alcohol_100],
      ["agua", datos.agua_100],
      ["AGS", datos.ags_100],
      ["sodio", datos.sodio_100],
      ["porción comestible", datos.porcion_comestible],
    ] as const;

    for (const [nombre, v] of numeros) {
      if (v === null) continue;
      if (Number.isNaN(v)) return setFallo(`El valor de ${nombre} no es un número.`);
      if (v < 0) return setFallo(`El valor de ${nombre} no puede ser negativo.`);
    }
    if (
      datos.porcion_comestible !== null &&
      (datos.porcion_comestible <= 0 || datos.porcion_comestible > 1)
    )
      return setFallo("La porción comestible va entre 0 y 1 (1 = se aprovecha entero).");

    iniciar(async () => {
      try {
        if (id) await actualizarIngrediente(id, datos);
        else await crearIngrediente(datos);
      } catch (e) {
        // `redirect()` de Next también viaja como excepción: esa se deja pasar.
        if (e && typeof e === "object" && "digest" in e) throw e;
        setFallo(e instanceof Error ? e.message : "No se ha podido guardar.");
      }
    });
  }

  const campoNumero = (
    k: ClaveNumero,
    etiqueta: string,
    unidad: string,
    paso = "0.001",
  ) => (
    <label className="campo">
      <span className="etiqueta">{etiqueta}</span>
      <span className="con-unidad">
        <input
          type="number"
          min={0}
          step={paso}
          inputMode="decimal"
          value={c[k]}
          onChange={(e) => pon(k, e.target.value)}
        />
        <span className="unidad">{unidad}</span>
      </span>
    </label>
  );

  return (
    <div className="rejilla" style={{ gap: 18, maxWidth: 720 }}>
      <label className="campo">
        <span className="etiqueta">Nombre</span>
        <input
          value={c.nombre}
          autoFocus
          placeholder="Pechuga de pollo a la plancha"
          onChange={(e) => pon("nombre", e.target.value)}
        />
      </label>

      <div className="rejilla dos">
        <div className="campo">
          <span className="etiqueta" id="etq-grupo">
            Grupo <span className="tenue">(opcional)</span>
          </span>
          <SelectorGrupoUnico
            grupos={grupos}
            valor={c.grupo}
            onCambiar={(g) => pon("grupo", g)}
          />
        </div>

        <label className="campo">
          <span className="etiqueta">Estado</span>
          <select
            value={c.estado}
            onChange={(e) => pon("estado", e.target.value as Estado)}
          >
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO[e]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <h2 style={{ margin: "0 0 4px" }}>Composición por 100 g</h2>
        <p className="tenue" style={{ fontSize: 13, margin: "0 0 12px" }}>
          De porción comestible: lo que queda después de quitar hueso, piel o
          cáscara.
        </p>

        <div className="rejilla cuatro">
          {campoNumero("prot_100", "Proteínas", "g")}
          {campoNumero("hc_100", "Hidratos", "g")}
          {campoNumero("grasa_100", "Grasa", "g")}
          {campoNumero("fibra_100", "Fibra", "g")}
        </div>

        <div className="kcal-calculada">
          <span className="etiqueta">Energía</span>
          <span className="cifra-xl" style={{ fontSize: 26 }}>
            {Math.round(kcal)}
            <small>kcal / 100 g</small>
          </span>
          <p>
            No se escribe: la calcula la base con Atwater —4·proteínas + 4·hidratos
            + 9·grasa + 7·alcohol—. <strong>La fibra no suma.</strong>
          </p>
        </div>
      </div>

      <div>
        <button
          type="button"
          className="enlace"
          aria-expanded={otros}
          onClick={() => setOtros(!otros)}
        >
          {otros ? "Ocultar los otros datos" : "Otros datos (alcohol, agua, sodio…)"}
        </button>

        {otros && (
          <div className="rejilla" style={{ gap: 14, marginTop: 12 }}>
            <div className="rejilla cuatro">
              {campoNumero("alcohol_100", "Alcohol", "g")}
              {campoNumero("agua_100", "Agua", "g")}
              {campoNumero("ags_100", "Saturadas", "g")}
              {campoNumero("sodio_100", "Sodio", "mg")}
            </div>
            <label className="campo" style={{ maxWidth: 260 }}>
              <span className="etiqueta">Porción comestible</span>
              <span className="con-unidad">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.0001"
                  inputMode="decimal"
                  value={c.porcion_comestible}
                  onChange={(e) => pon("porcion_comestible", e.target.value)}
                />
                <span className="unidad">de 1</span>
              </span>
              <small>1 = se aprovecha entero. Un plátano con piel ronda 0,65.</small>
            </label>
            <label className="campo">
              <span className="etiqueta">Notas</span>
              <textarea
                rows={2}
                value={c.notas ?? ""}
                placeholder="De dónde sale el dato, si lo has medido tú…"
                onChange={(e) => pon("notas", e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {fallo && <p className="aviso">{fallo}</p>}

      <div className="fila">
        <button className="principal" onClick={guardar} disabled={guardando}>
          {guardando ? "Guardando…" : id ? "Guardar cambios" : "Crear ingrediente"}
        </button>
        {onCancelar && (
          <button type="button" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
