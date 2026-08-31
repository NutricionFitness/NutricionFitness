-- ============================================================================
-- 0017 · Una medida casera propia nace siendo tuya
-- ============================================================================
--
-- `medidas_caseras` guarda dos cosas en la misma tabla: las **de serie** —las
-- 472 que cargó la fase 6, con `owner_id` nulo, que ve todo el mundo— y las que
-- añade cada cuenta. La política de inserción exige
-- `with check (owner_id = auth.uid())`, pero la columna **no tenía valor por
-- defecto**: sin mandarlo desde el cliente, entra nulo y el RLS lo rechaza.
--
-- Hasta ahora no se notaba porque no había pantalla para crear medidas: solo
-- las metía `scripts/cargar-medidas.mjs`, que manda `owner_id: null` a
-- propósito y usa la clave de servicio. Al darle pantalla, la primera prueba de
-- control de la undécima batería lo enseñó: «añadir una medida mía» fallaba.
--
-- Se arregla con el valor por defecto que ya tienen `personas`, `dietas`,
-- `perfiles_ajuste` y `plantillas`. El `with check` sigue siendo quien impide
-- ponerle otro dueño; esto solo evita tener que acordarse.
--
-- No afecta al cargador: manda `owner_id: null` explícito, y un valor explícito
-- gana al valor por defecto. Su `onConflict` apunta a `medidas_unicas`, que no
-- se toca aquí.
--
-- Idempotente: se puede volver a aplicar.
-- ============================================================================

alter table public.medidas_caseras
  alter column owner_id set default auth.uid();

comment on column public.medidas_caseras.owner_id is
  'NULL = medida de serie, la ve todo el mundo. Por defecto, la cuenta que la '
  'crea: la política de inserción exige que coincida con auth.uid().';
