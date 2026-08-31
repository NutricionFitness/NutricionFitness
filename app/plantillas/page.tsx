import ListaPlantillas from "@/components/ListaPlantillas";
import { plantillasGuardadas } from "./acciones";

export const dynamic = "force-dynamic";

/**
 * Las plantillas guardadas, todas juntas.
 *
 * Hasta la fase 25 solo se veían desde el selector de una comida: para saber
 * qué tenías guardado había que abrir una dieta. Aquí están todas, se pueden
 * buscar —también por lo que llevan dentro— y se pueden renombrar y quitar.
 *
 * Lo que NO se hace aquí es cambiar sus alimentos: una plantilla es una foto, y
 * los gramos solo se tocan donde hay una referencia contra la que cuadrar, o
 * sea dentro de una comida. Para eso: importarla, tocarla y volver a guardarla
 * reemplazando.
 */
export default async function Plantillas() {
  const plantillas = await plantillasGuardadas();

  return (
    <>
      <h1 style={{ marginBottom: 2 }}>Plantillas</h1>
      <p className="suave" style={{ margin: "6px 0 0", fontSize: 13.5, maxWidth: "68ch" }}>
        Opciones guardadas para reutilizar en cualquier comida de cualquier dieta.
        Se guardan desde una opción, con «guardar esta como plantilla», y se meten
        con «Importar plantilla». Las kilocalorías se calculan al vuelo con
        Atwater: dentro de una dieta con energía declarada pueden salir algo
        distintas.
      </p>

      <ListaPlantillas plantillas={plantillas} />
    </>
  );
}
