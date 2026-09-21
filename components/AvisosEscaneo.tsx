import type { Aviso } from "@/lib/openfoodfacts/convertir";

/**
 * Lo que el conversor tiene que decir sobre una ficha de Open Food Facts.
 *
 * Va en ámbar y no en rojo a propósito: el rojo de esta app es de las alergias
 * y de los borrados, y gastarlo aquí le quitaría fuerza allí. Los avisos graves
 * se distinguen por el texto en negrita, no por otro color.
 *
 * En su fichero, y no dentro de `AltaPorCodigo`, porque lo enseñan tres sitios
 * y uno de ellos es el comparador público, que no tiene sesión y no debe
 * arrastrar el alta —ni su acción de servidor— solo por una lista de avisos.
 *
 * `titulo` porque el de por defecto habla de guardar, y en el comparador no se
 * guarda nada.
 */
export default function AvisosEscaneo({
  avisos,
  titulo,
}: {
  avisos: Aviso[];
  titulo?: string;
}) {
  if (!avisos.length) return null;

  const graves = avisos.filter((a) => a.gravedad === "alto");
  return (
    <div className="aviso-caja avisos-escaneo">
      <div>
        <strong>
          {titulo ??
            (graves.length ? "Revisa esto antes de guardar" : "Un par de cosas de esta ficha")}
        </strong>
        <ul>
          {avisos.map((a) => (
            <li key={a.clave} className={a.gravedad === "alto" ? "grave" : undefined}>
              {a.texto}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
