"use client";

import { useState, useTransition } from "react";

import { cambiarCatalogoPublico } from "@/app/cuenta/acciones";

/**
 * El interruptor que publica tus ingredientes en el comparador.
 *
 * Nace apagado, y se enciende aquí y solo aquí. La migración 0011 no lo
 * enciende sola por mucho que la app tenga hoy una cuenta: publicar datos es de
 * esas cosas que se hacen mirando, no en una migración que nadie lee.
 *
 * El catálogo de BEDCA sale en el comparador pase lo que pase con este
 * interruptor: no es de nadie. Lo que decide es qué pasa con lo tuyo.
 */
export default function CatalogoPublico({ inicial }: { inicial: boolean }) {
  const [puesto, setPuesto] = useState(inicial);
  const [fallo, setFallo] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  function cambiar(valor: boolean) {
    setFallo(null);
    // Se pinta ya y se corrige si falla: un interruptor que tarda medio segundo
    // en moverse se pulsa dos veces.
    setPuesto(valor);
    iniciar(async () => {
      const r = await cambiarCatalogoPublico(valor);
      if (r.error) {
        setPuesto(!valor);
        setFallo(r.error);
      }
    });
  }

  return (
    <section className="ajuste-cuenta">
      <label className="opcion">
        <input
          type="checkbox"
          checked={puesto}
          disabled={pendiente}
          onChange={(e) => cambiar(e.target.checked)}
        />
        <span>
          <strong>Publicar mi catálogo en el comparador</strong>
        </span>
      </label>

      <p className="tenue">
        El comparador de alimentos es una página abierta, sin usuario ni
        contraseña. Con esto encendido, los ingredientes que has creado o
        escaneado <strong>se pueden buscar desde internet</strong>: su nombre,
        su grupo y su composición. No sale de quién son, ni tus personas, ni tus
        dietas, ni nada más.
      </p>
      <p className="tenue">
        Apagado, el comparador solo enseña el catálogo de BEDCA, que es público
        de partida.
      </p>

      {fallo && <p className="aviso">{fallo}</p>}
    </section>
  );
}
