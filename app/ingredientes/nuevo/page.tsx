import Link from "next/link";

import FormularioIngrediente from "@/components/FormularioIngrediente";
import { gruposDisponibles } from "../grupos";

export const dynamic = "force-dynamic";

export default async function NuevoIngrediente() {
  const grupos = await gruposDisponibles();

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
      <FormularioIngrediente grupos={grupos} />
    </>
  );
}
