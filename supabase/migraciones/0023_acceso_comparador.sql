-- ==========================================================================
-- 0023 · El comparador deja de ser de cualquiera: se entra con un correo
-- ==========================================================================
--
-- ## Lo que se quiere
--
-- Que al comparador —hasta ahora abierto a quien tuviera el enlace— solo
-- lleguen las personas que se llevan: al entrar se pide un correo, y vale si es
-- el de alguna persona dada de alta en `personas`. Quien ya ha entrado en la
-- app con su usuario y su contraseña pasa sin que se le pida nada.
--
-- ## Lo que hace falta de la base
--
-- Dos cosas:
--
--   1. Una columna `email` en `personas`. Nullable: una persona sin correo es
--      normal —no todas van a usar el comparador— y simplemente no tiene
--      acceso. Se guarda **en minúsculas y sin espacios**, y lo exige la base
--      y no solo la pantalla: si se colara «Ana@Gmail.com», el día que Ana
--      tecleara «ana@gmail.com» no entraría y nada daría error.
--
--   2. Una puerta para `anon` que conteste **sí o no** y nada más:
--      `correo_con_acceso_comparador`. `anon` no lee `personas` —el RLS de la
--      0001 la cierra a su dueño— y así sigue: la función no devuelve el
--      nombre, ni de quién es la persona, ni cuántas hay con ese correo. Solo
--      si existe alguna **activa** con él. Una persona desactivada pierde el
--      acceso sin tener que borrarle el correo.
--
-- ## Lo que esto NO es
--
-- Una contraseña. El correo es la clave, y un correo no es secreto: quien sepa
-- el de un cliente puede entrar. Es la puerta que se ha pedido —que el
-- comparador no sea de dominio público— y no más. Y por lo mismo, la función
-- contesta a cualquiera si un correo está dado de alta; es inevitable si el
-- correo es lo que abre.
--
-- Tampoco cierra las funciones de catálogo de la 0011, la 0021 y la 0022:
-- siguen abiertas a `anon`, porque las usa también la página del móvil
-- (`/escanear`) y porque lo que devuelven es el catálogo público —BEDCA y Open
-- Food Facts—, que no es de nadie. Lo que se cierra es la aplicación: la
-- página y sus acciones de servidor miran el acceso antes de llamarlas.
--
-- Idempotente: se puede volver a aplicar.
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- La columna
--
-- El `check` va con la columna, como el de `peso_kg` en la 0010: con
-- `if not exists` se añaden los dos juntos o ninguno. El patrón del correo es
-- deliberadamente flojo —algo, arroba, algo, punto, algo—: lo que se quiere
-- cazar es el dedo que se deja la arroba, no validar el RFC 5322.
-- ---------------------------------------------------------------------------
alter table public.personas
  add column if not exists email text
    check (
      email is null
      or (
        email = lower(btrim(email))
        and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        and length(email) <= 254
      )
    );

comment on column public.personas.email is
  'Correo de la persona, en minúsculas. Sirve de clave para entrar en el '
  'comparador (0023). Nulo = sin acceso.';

create index if not exists personas_email
  on public.personas (email)
  where email is not null and activa;

-- ---------------------------------------------------------------------------
-- La puerta
--
-- Normaliza también aquí, además de en la aplicación: la función es pública y
-- no tiene por qué fiarse de quien la llame.
-- ---------------------------------------------------------------------------
create or replace function public.correo_con_acceso_comparador(correo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select correo is not null
     and length(correo) <= 254
     and exists (
       select 1 from public.personas p
        where p.activa
          and p.email = lower(btrim(correo))
     );
$$;

comment on function public.correo_con_acceso_comparador(text) is
  'Si hay alguna persona activa con ese correo. Solo sí o no: ni quién es ni '
  'de quién. Es lo que abre el comparador sin sesión (0023).';

-- `revoke` primero porque PostgreSQL da permiso de ejecución a `public` en
-- cuanto se crea una función.
revoke all on function public.correo_con_acceso_comparador(text) from public;
grant execute on function public.correo_con_acceso_comparador(text) to anon, authenticated;
