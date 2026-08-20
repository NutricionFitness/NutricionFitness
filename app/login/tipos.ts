/** Lo que devuelven las acciones de los formularios de acceso.
 *  Vive fuera de `acciones.ts` porque un fichero "use server" solo debe exportar
 *  funciones asíncronas. */
export type EstadoFormulario = { error?: string; ok?: string };
