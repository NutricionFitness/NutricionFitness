"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  AltaEscaneada,
  DatosIngrediente,
  PropuestaEscaneo,
} from "@/app/ingredientes/tipos";
import AltaPorCodigo from "./AltaPorCodigo";
import FormularioIngrediente from "./FormularioIngrediente";

/**
 * Dar de alta un ingrediente, con o sin código de barras.
 *
 * El escaneo **rellena el formulario**, no crea nada. Es lo que permite que los
 * datos de Open Food Facts —que los teclea gente desde una foto de la etiqueta—
 * entren en el catálogo habiendo pasado por delante de alguien.
 *
 * Al llegar una propuesta se remonta el formulario entero con `key`. Es más
 * limpio que ir metiéndole valores desde fuera: el formulario ya sabe
 * arrancarse desde unos datos iniciales, y así escanear un segundo producto no
 * deja pegado ningún resto del primero.
 */
export default function AltaIngrediente({
  grupos,
  codigoInicial,
}: {
  grupos: string[];
  /** `?ean=` — se llega aquí desde un escaneo que no encontró ficha. */
  codigoInicial?: string;
}) {
  const router = useRouter();
  const [propuesta, setPropuesta] = useState<PropuestaEscaneo | null>(null);
  const [codigo, setCodigo] = useState<string | null>(codigoInicial ?? null);
  const [version, setVersion] = useState(0);

  const inicial: DatosIngrediente | undefined = propuesta
    ? {
        nombre: propuesta.nombre,
        grupo: propuesta.grupo,
        estado: propuesta.estado,
        prot_100: propuesta.prot_100,
        hc_100: propuesta.hc_100,
        grasa_100: propuesta.grasa_100,
        fibra_100: propuesta.fibra_100,
        alcohol_100: propuesta.alcohol_100,
        agua_100: propuesta.agua_100,
        ags_100: propuesta.ags_100,
        sodio_100: propuesta.sodio_100,
        porcion_comestible: propuesta.porcion_comestible,
        notas: propuesta.notas,
      }
    : undefined;

  const alta: AltaEscaneada | undefined = propuesta
    ? {
        codigo_barras: propuesta.codigo_barras,
        kcal_ref: propuesta.kcal_ref,
        alergenos: propuesta.alergenos,
        trazas: propuesta.trazas,
      }
    : codigo
      ? // Sin ficha: no hay datos que prerrellenar, pero el código se guarda
        // igual. Es lo que hace que el siguiente escaneo del mismo envase lo
        // encuentre en vez de volver a preguntar fuera.
        { codigo_barras: codigo, kcal_ref: null, alergenos: [], trazas: [] }
      : undefined;

  return (
    <>
      <div className="alta-escaneo">
        <div>
          <strong>¿Es un producto envasado?</strong>
          <p className="tenue">
            Escanea su código de barras y se rellena esto con lo que declara la
            etiqueta, según Open Food Facts. Lo compruebas y lo guardas tú.
          </p>
        </div>
        <div className="fila">
          <AltaPorCodigo
            onPropuesta={(p) => {
              setPropuesta(p);
              setCodigo(p.codigo_barras);
              setVersion((v) => v + 1);
            }}
            onSinFicha={(c) => {
              setPropuesta(null);
              setCodigo(c);
              setVersion((v) => v + 1);
            }}
            onEnCatalogo={(id) => router.push(`/ingredientes/${id}`)}
          />
        </div>
      </div>

      {codigo && (
        <p className="tenue" style={{ fontSize: 13, margin: "-4px 0 0" }}>
          Se guardará con el código <span className="cifra">{codigo}</span>.
        </p>
      )}

      <FormularioIngrediente
        key={version}
        grupos={grupos}
        inicial={inicial}
        alta={alta}
        avisos={propuesta?.avisos}
      />
    </>
  );
}
