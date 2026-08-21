"use client";

import { useEffect, useState } from "react";

type Tema = "claro" | "oscuro";

/**
 * Claro u oscuro, a mano.
 *
 * Por defecto manda el sistema: mientras no se toque el botón no hay nada
 * guardado y el CSS decide con `prefers-color-scheme`. En cuanto se pulsa, la
 * elección se sella en `data-tema` —que gana a la consulta de medios— y se
 * recuerda.
 *
 * El icono no se dibuja hasta después de montar. En el servidor no se sabe qué
 * tema tiene el navegador, y pintar el sol para acabar enseñando la luna es un
 * parpadeo y un aviso de hidratación.
 */
export default function CambiarTema() {
  const [tema, setTema] = useState<Tema | null>(null);

  useEffect(() => {
    const sellado = document.documentElement.dataset.tema;
    if (sellado === "claro" || sellado === "oscuro") {
      setTema(sellado);
      return;
    }
    setTema(
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro",
    );
  }, []);

  function alternar() {
    const siguiente: Tema = tema === "oscuro" ? "claro" : "oscuro";
    document.documentElement.dataset.tema = siguiente;
    setTema(siguiente);
    try {
      localStorage.setItem("tema", siguiente);
    } catch {
      /* ventana privada: el tema vale para esta pestaña y ya */
    }
  }

  return (
    <button
      type="button"
      className="tema"
      onClick={alternar}
      aria-label={tema === "oscuro" ? "Pasar al tema claro" : "Pasar al tema oscuro"}
      title={tema === "oscuro" ? "Tema claro" : "Tema oscuro"}
    >
      {tema === null ? (
        <span style={{ width: 16, height: 16 }} />
      ) : tema === "oscuro" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path
            d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path
            d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
