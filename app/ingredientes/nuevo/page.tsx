import Link from "next/link";

import AltaIngrediente from "@/components/AltaIngrediente";
import { normalizarEan } from "@/lib/openfoodfacts/ean";
import { gruposDisponibles } from "../grupos";

export const dynamic = "force-dynamic";

export default async function NuevoIngrediente({
  searchParams,
}: {
  /** `?ean=` lo pone el escáner cuando Open Food Facts no conoce el código:
   *  se llega aquí a rellenarlo a mano, pero con el código ya guardado. */
  searchParams: Promise<{ ean?: string }>;
}) {
  const [grupos, { ean }] = await Promise.all([gruposDisponibles(), searchParams]);

  // Se vuelve a comprobar aquí: lo que llega por la URL lo escribe cualquiera.
  const codigo = typeof ean === "string" ? normalizarEan(ean)?.codigo : undefined;

  return (
    <>
      <p className="migas">
        <Link href="/ingredientes">← Ingredientes</Link>
      </p>
      <h1>Nuevo ingrediente</h1>
      <p className="sub">
        Para lo que no está en BEDCA: una marca concreta, una receta tuya, un
        suplemento. Lo verás solo tú, y aparecerá en el buscador de las dietas
        como cualquier otro.
      </p>
      <AltaIngrediente grupos={grupos} codigoInicial={codigo} />
    </>
  );
}
