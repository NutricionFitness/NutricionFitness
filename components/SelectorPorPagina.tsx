"use client";

/**
 * Cuántas filas por página.
 *
 * Vive dentro del formulario de búsqueda y se envía con él, así que al cambiarlo
 * se conservan el texto buscado y el grupo. Y como `pagina` no es un campo del
 * formulario, al enviarlo desaparece de la URL: cambiar el tamaño te devuelve a
 * la primera página, que es lo único que tiene sentido —la página 9 de 25 en
 * filas de 200 no existe—.
 *
 * `requestSubmit` es la comodidad; si el navegador no lo tiene, el botón
 * «Buscar» de al lado hace exactamente lo mismo.
 */
export default function SelectorPorPagina({
  valor,
  opciones,
}: {
  valor: number;
  opciones: readonly number[];
}) {
  return (
    <label className="por-pagina">
      Ver
      <select
        name="por"
        defaultValue={valor}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {opciones.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      por página
    </label>
  );
}
