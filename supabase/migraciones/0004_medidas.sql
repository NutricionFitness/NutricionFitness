-- ============================================================================
-- Medidas caseras y equivalencias crudo ↔ cocido.
--
-- Pensar en gramos para todo es incómodo: nadie pesa un huevo, lo cuenta. Las
-- medidas caseras son una comodidad de ENTRADA y de LECTURA, no un dato que se
-- guarde en el componente. Si se guardaran, el primer ajuste las desincronizaría
-- —el motor mueve gramos, no unidades— y acabarías viendo «2 huevos» junto a
-- 87 g. Los gramos mandan siempre; la medida solo traduce.
-- ============================================================================

create table public.medidas_caseras (
  id             uuid primary key default gen_random_uuid(),
  ingrediente_id bigint not null references public.ingredientes(id) on delete cascade,
  -- NULL = medida de serie, la ve todo el mundo. Con dueño = la añadió alguien.
  owner_id       uuid references auth.users(id) on delete cascade,
  nombre         text not null check (length(trim(nombre)) > 0),
  gramos         numeric(9,2) not null check (gramos > 0),
  orden          integer not null default 0,
  creado_en      timestamptz not null default now(),
  constraint medidas_unicas unique nulls not distinct (ingrediente_id, owner_id, nombre)
);

create index medidas_ingrediente on public.medidas_caseras (ingrediente_id);
create index medidas_owner       on public.medidas_caseras (owner_id);

-- ----------------------------------------------------------------------------
-- Equivalencias entre la versión cruda y la cocida del mismo alimento.
--
-- `factor` son los gramos de producto cocido que salen de un gramo crudo. Se
-- deducen del balance de materia seca de la propia BEDCA:
--
--     factor = (100 − agua_crudo) / (100 − agua_cocido)
--
-- Es una estimación, no una medida: supone que solo se pierde o se gana agua.
-- Por eso los fritos quedan fuera (absorben aceite) y por eso se guarda de dónde
-- sale cada factor, para poder revisarlo.
-- ----------------------------------------------------------------------------
create table public.equivalencias_coccion (
  id                    uuid primary key default gen_random_uuid(),
  ingrediente_crudo_id  bigint not null references public.ingredientes(id) on delete cascade,
  ingrediente_cocido_id bigint not null references public.ingredientes(id) on delete cascade,
  factor                numeric(7,3) not null check (factor > 0 and factor < 10),
  origen                text not null default 'materia seca BEDCA',
  agua_crudo            numeric(6,2),
  agua_cocido           numeric(6,2),
  creado_en             timestamptz not null default now(),
  constraint equivalencia_unica unique (ingrediente_crudo_id, ingrediente_cocido_id),
  constraint equivalencia_no_reflexiva check (ingrediente_crudo_id <> ingrediente_cocido_id)
);

create index equivalencias_crudo  on public.equivalencias_coccion (ingrediente_crudo_id);
create index equivalencias_cocido on public.equivalencias_coccion (ingrediente_cocido_id);

-- ----------------------------------------------------------------------------
-- Permisos y control de acceso
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.medidas_caseras to authenticated;
grant select on public.equivalencias_coccion to authenticated;

alter table public.medidas_caseras       enable row level security;
alter table public.equivalencias_coccion enable row level security;

create policy medidas_leer on public.medidas_caseras
  for select to authenticated
  using (owner_id is null or owner_id = auth.uid());

create policy medidas_crear on public.medidas_caseras
  for insert to authenticated with check (owner_id = auth.uid());

create policy medidas_editar on public.medidas_caseras
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy medidas_borrar on public.medidas_caseras
  for delete to authenticated using (owner_id = auth.uid());

-- Las equivalencias son catálogo: se leen y no se tocan desde la app.
create policy equivalencias_leer on public.equivalencias_coccion
  for select to authenticated using (true);
