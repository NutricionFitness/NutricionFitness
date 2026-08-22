-- ---------------------------------------------------------------------------
-- 0008 — Código de barras
--
-- BEDCA no tiene códigos de barras y nunca los va a tener: es una base de
-- composición de alimentos genéricos —«arroz blanco, crudo»—, no un catálogo de
-- productos del súper. Un código de barras identifica un envase concreto de una
-- marca concreta, y esa información viene de otro sitio (Open Food Facts).
--
-- Aquí solo hacen falta dos cosas:
--
--   1. Guardar el código en el ingrediente, para que el segundo escaneo del
--      mismo yogur encuentre el que ya diste de alta en vez de duplicarlo. Esa
--      es toda la razón del índice único.
--   2. Poder distinguir un alérgeno que viene DECLARADO en la etiqueta de uno
--      deducido por `scripts/derivar-alergenos.mjs`.
--
-- El punto 2 no es cosmético. La derivación borra e inserta `origen =
-- 'derivado'` cada vez que se ejecuta, y un producto de Open Food Facts no
-- tiene código LanguaL: si sus alérgenos se guardaran como 'derivado', la
-- siguiente pasada del script los borraría y no podría deducir ninguno en su
-- lugar. Se quedaría sin alérgenos y sin decirlo.
--
-- Tampoco valía 'manual': eso significa «lo escribió una persona», y nadie lo
-- ha escrito. 'declarado' es lo que es —lo pone la etiqueta— y el script no lo
-- toca, porque solo borra lo suyo.
-- ---------------------------------------------------------------------------

alter table public.ingredientes
  add column if not exists codigo_barras text;

comment on column public.ingredientes.codigo_barras is
  'EAN-8/13, UPC-A o GTIN-14, solo dígitos y con el dígito de control ya '
  'comprobado por la app. Nulo en todo lo que viene de BEDCA.';

-- Solo dígitos. La app ya valida el dígito de control antes de llegar aquí,
-- pero la base no se fía de la app: aquí se comprueba la forma.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ingredientes_codigo_barras_digitos'
  ) then
    alter table public.ingredientes
      add constraint ingredientes_codigo_barras_digitos
      check (codigo_barras is null or codigo_barras ~ '^[0-9]{8,14}$');
  end if;
end $$;

-- Un código no se repite dentro del mismo ámbito.
--
-- Índice parcial y no restricción, porque la inmensa mayoría de las filas —los
-- 2.157 de BEDCA— tienen el código a nulo y no deben competir entre sí.
--
-- `nulls not distinct` es por el catálogo compartido: ahí `owner_id` es nulo, y
-- sin esto dos filas compartidas con el mismo código pasarían las dos, que es
-- justo el duplicado que se quiere evitar.
create unique index if not exists ingredientes_codigo_barras_unico
  on public.ingredientes (owner_id, codigo_barras) nulls not distinct
  where codigo_barras is not null;

-- Se busca por código con el catálogo entero delante, así que conviene el
-- índice aunque el único de arriba ya cubra la mayor parte de los casos: aquel
-- lleva `owner_id` de primera columna y una búsqueda por código suelto no lo
-- aprovecharía.
create index if not exists ingredientes_codigo_barras
  on public.ingredientes (codigo_barras) where codigo_barras is not null;

-- ------------------------------------------------- alérgenos declarados -----

alter table public.ingrediente_alergenos
  drop constraint if exists ingrediente_alergenos_origen_check;

alter table public.ingrediente_alergenos
  add constraint ingrediente_alergenos_origen_check
  check (origen in ('derivado', 'manual', 'declarado'));

comment on column public.ingrediente_alergenos.origen is
  '''derivado'': lo dedujo scripts/derivar-alergenos.mjs a partir de LanguaL y '
  'del nombre. ''manual'': lo escribió una persona. ''declarado'': lo dice la '
  'etiqueta del producto, vía Open Food Facts. La derivación solo borra lo '
  'suyo, así que ni ''manual'' ni ''declarado'' se pierden al relanzarla.';
