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
  /** El peso de la persona. Sin él no hay gramos por kilo que enseñar. */
  pesoKg?: number | null;
  /** El del día se pinta más marcado y lleva su nombre en vez de «Suma». */
  dia?: boolean;
}) {
  // Los g/kg se enseñan también por comida, no solo en el día: la referencia
  // («1,8 g de proteína por kilo») es diaria, pero al repartirla entre comidas
  // se quiere ver cuánto de esa cuota lleva cada una.
  //
  // Con un decimal, sin embargo, la cifra de una comida no dice nada: 3,2 g de
  // grasa en 78 kg salen «0 g/kg», que parece un fallo. Por eso el día lleva un
  // decimal —es la escala en que se prescribe— y la comida dos.
  const gk = porKilo(propuesto?.macros ?? tot.macros, pesoKg);
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
              title={
                dia
                  ? `Gramos de ${ETIQUETA_LARGA[m]} al día por cada kilo de peso de la persona`
                  : `Lo que aporta esta comida a los gramos de ${ETIQUETA_LARGA[m]} por kilo del día`
              }
            >
              ({gk[m].toLocaleString("es-ES", { maximumFractionDigits: dia ? 1 : 2 })} g/kg)
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
