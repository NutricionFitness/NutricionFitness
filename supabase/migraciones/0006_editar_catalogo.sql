-- ---------------------------------------------------------------------------
-- 0006 — Editar el catálogo compartido
--
-- Hasta aquí los ingredientes de BEDCA eran de solo lectura desde la app: la
-- política de edición pedía `owner_id = auth.uid()` y ellos no tienen dueño
-- (`owner_id` nulo). Corregir un dato de la fuente obligaba a duplicar el
-- ingrediente, y entonces la corrección no llegaba a las dietas que ya usaban el
-- original: justo las que interesa arreglar.
--
-- Se abre la edición al catálogo compartido y se marca lo que se toca a mano,
-- para que una recarga de BEDCA no lo machaque sin enterarse.
--
-- El borrado NO se abre. Un ingrediente compartido está dentro de dietas ya
-- guardadas; se puede corregir, no se puede hacer desaparecer.
-- ---------------------------------------------------------------------------

alter table public.ingredientes
  add column if not exists editado_a_mano boolean not null default false;

comment on column public.ingredientes.editado_a_mano is
  'Corregido desde la app. scripts/cargar-ingredientes.mjs no lo sobrescribe.';

drop policy if exists ingredientes_editar on public.ingredientes;

create policy ingredientes_editar on public.ingredientes
  for update to authenticated
  using      (owner_id is null or owner_id = auth.uid())
  with check (owner_id is null or owner_id = auth.uid());
