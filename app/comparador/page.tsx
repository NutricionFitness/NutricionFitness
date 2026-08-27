import type { Metadata } from "next";
import Link from "next/link";

import Comparador from "@/components/Comparador";

export const metadata: Metadata = {
  title: "Comparador de alimentos",
  description:
    "Compara alimentos a igualdad de kilocalorías: qué macronutrientes aporta " +
    "cada uno y por cuál se puede cambiar. Datos de BEDCA (AESAN).",
};

/**
 * El comparador, sin sesión.
 *
 * Es la única página de la app a la que llega alguien que no ha entrado —junto
 * con la del escaneo remoto—, así que no toca ninguna tabla: todo pasa por las
 * dos funciones públicas de la migración 0011.
 */
export default function PaginaComparador() {
  return (
    <>
      <header className="cabecera-publica">
        <h1>Comparador de alimentos</h1>
        <p>
          Elige un alimento y una cantidad. Te dice lo que aporta y por qué lo
          puedes cambiar <strong>sin mover las kilocalorías</strong>: las
          cantidades que se proponen son las que aportan la misma energía, así
          que lo único que cambia es el reparto de macronutrientes.
        </p>
      </header>

      <Comparador />

      <footer className="pie-publico">
        <p>
          Composición de alimentos de la <strong>Base de Datos Española de
          Composición de Alimentos (BEDCA)</strong>, de la Agencia Española de
          Seguridad Alimentaria y Nutrición. Los valores son por 100 g de
          porción comestible. La energía se calcula con los factores de Atwater
          (4 kcal/g de proteína e hidratos, 9 de grasa, 7 de alcohol); la fibra
          no aporta energía en este cálculo.
        </p>
        <p>
          Esto es una herramienta de cálculo, no un consejo dietético: quien
          decide qué come una persona es un profesional que la conoce.
        </p>
        <p>
          <Link href="/login">Entrar</Link>
        </p>
      </footer>
    </>
  );
}
