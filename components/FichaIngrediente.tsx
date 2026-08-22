"use client";

import { useState } from "react";

import {
  ETIQUETA_ESTADO,
  kcalAtwater,
  type DatosIngrediente,
  type Estado,
} from "@/app/ingredientes/tipos";
import FormularioIngrediente from "./FormularioIngrediente";

export interface Medida {
  id: string;
  nombre: string;
  gramos: number;
}

export interface FichaCompleta extends DatosIngrediente {
  id: number;
  propio: boolean;
  codigo_bedca: string | null;
  origen: string | null;
  kcal_ref: number | null;
  revisado: boolean;
  editado_a_mano: boolean;
  actualizado_en: string;
  medidas: Medida[];
}

const n2 = (v: number | null) =>
  v === null || v === undefined ? "—" : (Math.round(v * 1000) / 1000).toLocaleString("es-ES");

export default function FichaIngrediente({
  ficha,
  grupos,
  alergenos,
}: {
  ficha: FichaCompleta;
  grupos: string[];
  /** La tarjeta de alérgenos, que se monta en el servidor con su catálogo. */
  alergenos?: React.ReactNode;
}) {
  const [editando, setEditando] = useState(false);

  const kcal = kcalAtwater(ficha);
  // BEDCA trae su propia energía en el 42% de los casos. Se enseña al lado como
  // contraste, no como alternativa: el motor calcula siempre con Atwater.
  const desvio =
    ficha.kcal_ref !== null && kcal > 0
      ? Math.round(((ficha.kcal_ref - kcal) / kcal) * 1000) / 10
      : null;

  if (editando)
    return (
      <>
        <h1>{ficha.nombre}</h1>
        <p className="sub">Corrigiendo la ficha.</p>
        <FormularioIngrediente
          grupos={grupos}
          id={ficha.id}
          inicial={ficha}
          onCancelar={() => setEditando(false)}
        />
      </>
    );

  return (
    <>
      <div className="fila" style={{ alignItems: "flex-start" }}>
        <h1 style={{ marginBottom: 2 }}>{ficha.nombre}</h1>
        <span style={{ flex: 1 }} />
        <button className="principal" onClick={() => setEditando(true)}>
          Editar
        </button>
      </div>

      <div className="fila sub" style={{ gap: 8, marginTop: 8 }}>
        <span className="chip">{ficha.grupo ?? "sin grupo"}</span>
        <span className="chip">{ETIQUETA_ESTADO[ficha.estado as Estado]}</span>
        <span className="chip">{ficha.propio ? "tuyo" : "catálogo BEDCA"}</span>
        {ficha.editado_a_mano && !ficha.propio && (
          <span className="chip mas">corregido a mano</span>
        )}
      </div>

      <div className="rejilla dos" style={{ marginTop: 22, alignItems: "start" }}>
        <div className="tarjeta">
          <h2 style={{ margin: "0 0 2px", fontSize: 14 }}>Composición por 100 g</h2>
          <p className="tenue" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
            De porción comestible: lo que queda tras quitar hueso, piel o cáscara.
          </p>

          <div className="kcal-calculada" style={{ marginBottom: 6 }}>
            <span className="etiqueta">Energía</span>
            <span className="cifra-xl" style={{ fontSize: 26 }}>
              {Math.round(kcal)}
              <small>kcal / 100 g</small>
            </span>
            <p>
              Calculada con Atwater: 4·proteínas + 4·hidratos + 9·grasa +
              7·alcohol. <strong>La fibra no suma.</strong>
            </p>
          </div>

          <table className="datos">
            <tbody>
              <tr>
                <td>Proteínas</td>
                <td className="num">{n2(ficha.prot_100)} g</td>
              </tr>
              <tr>
                <td>Hidratos</td>
                <td className="num">{n2(ficha.hc_100)} g</td>
              </tr>
              <tr>
                <td>Grasa</td>
                <td className="num">{n2(ficha.grasa_100)} g</td>
              </tr>
              <tr>
                <td className="suave">de la que es saturada</td>
                <td className="num suave">{n2(ficha.ags_100)} g</td>
              </tr>
              <tr>
                <td>Fibra</td>
                <td className="num">{n2(ficha.fibra_100)} g</td>
              </tr>
              <tr>
                <td>Alcohol</td>
                <td className="num">{n2(ficha.alcohol_100)} g</td>
              </tr>
              <tr>
                <td>Agua</td>
                <td className="num">{n2(ficha.agua_100)} g</td>
              </tr>
              <tr>
                <td>Sodio</td>
                <td className="num">
                  {ficha.sodio_100 === null ? "—" : `${n2(ficha.sodio_100)} mg`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rejilla" style={{ gap: 14 }}>
          {alergenos}

          <div className="tarjeta">
            <h2 style={{ margin: "0 0 12px", fontSize: 14 }}>La ficha</h2>
            <table className="datos">
              <tbody>
                <tr>
                  <td>Porción comestible</td>
                  <td className="num">
                    {ficha.porcion_comestible === null
                      ? "—"
                      : `${n2(ficha.porcion_comestible)} de 1`}
                  </td>
                </tr>
                <tr>
                  <td>Energía declarada</td>
                  <td className="num">
                    {ficha.kcal_ref === null ? (
                      <span className="tenue">no la trae</span>
                    ) : (
                      <>
                        {n2(ficha.kcal_ref)} kcal
                        {desvio !== null && (
                          <small className="tenue">
                            {" "}
                            ({desvio >= 0 ? "+" : ""}
                            {desvio.toLocaleString("es-ES")}%)
                          </small>
                        )}
                      </>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Origen</td>
                  <td className="num suave">{ficha.origen ?? "—"}</td>
                </tr>
                <tr>
                  <td>Código BEDCA</td>
                  <td className="num suave">{ficha.codigo_bedca ?? "—"}</td>
                </tr>
                <tr>
                  <td>Última corrección</td>
                  <td className="num suave">
                    {new Date(ficha.actualizado_en).toLocaleDateString("es-ES")}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="tarjeta">
            <h2 style={{ margin: "0 0 10px", fontSize: 14 }}>Medidas caseras</h2>
            {ficha.medidas.length === 0 ? (
              <p className="tenue" style={{ margin: 0, fontSize: 13.5 }}>
                Ninguna. Este ingrediente se pesa.
              </p>
            ) : (
              <ul className="medidas">
                {ficha.medidas.map((m) => (
                  <li key={m.id}>
                    1 {m.nombre} <span className="tenue">=</span>{" "}
                    <b className="cifra">{Math.round(Number(m.gramos))} g</b>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {ficha.notas && (
            <div className="tarjeta">
              <h2 style={{ margin: "0 0 6px", fontSize: 14 }}>Notas</h2>
              <p className="suave" style={{ margin: 0, fontSize: 13.5 }}>
                {ficha.notas}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
