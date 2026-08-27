"use client";

import { porKilo, type Totales } from "@/lib/dominio/totales";

/** Un decimal y con coma: «30,4», no «30.4». La app escribe en español. */
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("es-ES");

/**
 * Lo que suma un trozo de dieta: una comida, o el día entero.
 *
 * Va **debajo** de la tabla y no en la cabecera porque es un total: se lee
 * después de lo que se suma, igual que en una factura. La cabecera sigue
 * llevando las kcal sueltas, que es el dato que se busca de un vistazo sin
 * leer nada más.
 *
 * Con propuesta encima se enseñan las dos columnas —lo que hay y lo que
 * quedaría—, porque comparar es justo lo que se está haciendo en ese momento.
 */
export default function TotalesDe({
  titulo,
  tot,
  propuesto,
  pesoKg = null,
  dia = false,
}: {
  titulo: string;
  tot: Totales;
  propuesto: Totales | null;
  pesoKg?: number | null;
  /** El del día lleva además los gramos por kilo, que solo tienen sentido ahí. */
  dia?: boolean;
}) {
  // Los g/kg son una cifra DIARIA: «2 g de proteína por kilo» se dice de lo que
  // se come en un día, no de lo que se come en un desayuno.
  const gk = dia ? porKilo(propuesto?.macros ?? tot.macros, pesoKg) : null;
  const t = propuesto ?? tot;

  return (
    <div className={dia ? "totales dia" : "totales"}>
      <span className="que">{dia ? titulo : "Suma"}</span>

      <span className="dato">
        <b className="cifra">{Math.round(tot.energia)}</b>
        {propuesto && (
          <>
            <span aria-hidden> → </span>
            <b className="cifra propuesta">{Math.round(propuesto.energia)}</b>
          </>
        )}
        <small>kcal</small>
      </span>

      {(["prot", "hc", "grasa"] as const).map((m) => (
        <span className="dato" key={m}>
          <span className={`etiqueta-macro ${m}`}>{ETIQUETA[m]}</span>
          <b className="cifra">{n1(tot.macros[m])}</b>
          {propuesto && (
            <>
              <span aria-hidden> → </span>
              <b className="cifra propuesta">{n1(propuesto.macros[m])}</b>
            </>
          )}
          <small>g</small>
          {gk && (
            <small
              className="por-kilo"
              title={`Gramos de ${ETIQUETA_LARGA[m]} por cada kilo de peso de la persona`}
            >
              ({gk[m].toLocaleString("es-ES", { maximumFractionDigits: 1 })} g/kg)
            </small>
          )}
        </span>
      ))}

      <span className="separa" />

      <span className="reparto-vivo" title={`Proteína ${Math.round(t.pct.prot)}%, hidratos ${Math.round(t.pct.hc)}%, grasa ${Math.round(t.pct.grasa)}%`}>
        <span className="cifras">
          <b className="prot">{Math.round(t.pct.prot)}</b>
          <i>/</i>
          <b className="hc">{Math.round(t.pct.hc)}</b>
          <i>/</i>
          <b className="grasa">{Math.round(t.pct.grasa)}</b>
        </span>
      </span>
    </div>
  );
}

const ETIQUETA = { prot: "P", hc: "HC", grasa: "G" } as const;
const ETIQUETA_LARGA = { prot: "proteína", hc: "hidratos", grasa: "grasa" } as const;
