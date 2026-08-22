import EscanerRemoto from "@/components/EscanerRemoto";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Escanear — App Nutrición",
  // Que no acabe en ningún buscador: es un enlace de un solo uso.
  robots: { index: false, follow: false },
};

/**
 * La página a la que lleva el QR. **Pública, sin sesión iniciada.**
 *
 * Es la única ruta de la app fuera del middleware de sesión, y por eso no toca
 * la base desde el servidor: aquí no hay usuario, así que no habría con qué
 * consultar. Todo lo que hace pasa en el navegador contra las tres funciones de
 * la migración 0009, que comprueban el vale y no devuelven ningún dato.
 *
 * La forma del vale se mira aquí solo para no encender la cámara por un
 * enlace mal copiado; quien decide de verdad es la base.
 */
export default async function EscanearRemoto({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!/^[0-9a-f]{32,64}$/.test(token))
    return (
      <div className="remoto acabado">
        <div className="cartel">
          <p className="grande">Este enlace no vale</p>
          <p className="tenue">
            Vuelve a pedir el código QR en el ordenador y escanéalo otra vez.
          </p>
        </div>
      </div>
    );

  return <EscanerRemoto token={token} />;
}
