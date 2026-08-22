-- ---------------------------------------------------------------------------
-- 0007 — Alergias
--
-- Tres tablas y una columna:
--   · alergenos             el catálogo. Los catorce del Anexo II del
--                           Reglamento (UE) 1169/2011 van con owner_id nulo y
--                           son de todos; los que declare cada uno son suyos.
--                           La fructosa, el piñón o la castaña no están en el
--                           Anexo II y se declaran así.
--   · ingrediente_alergenos qué lleva cada ingrediente, y si lo puso una persona
--                           o lo dedujo el script de derivación.
--   · persona_alergias      a qué es alérgica cada persona.
--   · ingredientes.alergenos_revisados
--                           si alguien ha confirmado la lista. Deducido no es
--                           lo mismo que comprobado, y la pantalla lo dice.
--
-- Lo que NO hace esta migración: decidir si una dieta es segura. La app avisa
-- de coincidencias; la responsabilidad de comprobarlo sigue siendo de quien
-- firma la dieta.
-- ---------------------------------------------------------------------------

create table if not exists public.alergenos (
  id          bigint generated always as identity primary key,
  owner_id    uuid references auth.users(id) on delete cascade,
  codigo      text not null check (length(trim(codigo)) > 0),
  nombre      text not null check (length(trim(nombre)) > 0),
  detalle     text,
  estandar    boolean not null default false,
  creado_en   timestamptz not null default now(),
  constraint alergenos_codigo_unico unique nulls not distinct (owner_id, codigo)
);

create table if not exists public.ingrediente_alergenos (
  ingrediente_id bigint not null references public.ingredientes(id) on delete cascade,
  alergeno_id    bigint not null references public.alergenos(id)    on delete cascade,
  -- 'derivado' lo puso scripts/derivar-alergenos.mjs; 'manual', una persona.
  -- La derivación no pisa lo manual.
  origen         text not null default 'manual' check (origen in ('derivado', 'manual')),
  creado_en      timestamptz not null default now(),
  primary key (ingrediente_id, alergeno_id)
);

create index if not exists ingrediente_alergenos_alergeno
  on public.ingrediente_alergenos (alergeno_id);

create table if not exists public.persona_alergias (
  persona_id  uuid   not null references public.personas(id)  on delete cascade,
  alergeno_id bigint not null references public.alergenos(id) on delete cascade,
  notas       text,
  creado_en   timestamptz not null default now(),
  primary key (persona_id, alergeno_id)
);

create index if not exists persona_alergias_alergeno
  on public.persona_alergias (alergeno_id);

alter table public.ingredientes
  add column if not exists alergenos_revisados boolean not null default false;

comment on column public.ingredientes.alergenos_revisados is
  'Alguien ha confirmado la lista de alérgenos. Deducido no es comprobado.';

-- --------------------------------------------------------------------- RLS --

alter table public.alergenos             enable row level security;
alter table public.ingrediente_alergenos enable row level security;
alter table public.persona_alergias      enable row level security;

-- El catálogo estándar lo ve todo el mundo; los propios, solo su dueño.
create policy alergenos_leer on public.alergenos
  for select to authenticated
  using (owner_id is null or owner_id = auth.uid());

-- Los catorce del Anexo II no se tocan: son la norma, no una preferencia.
create policy alergenos_crear on public.alergenos
  for insert to authenticated
  with check (owner_id = auth.uid() and estandar = false);

create policy alergenos_editar on public.alergenos
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy alergenos_borrar on public.alergenos
  for delete to authenticated
  using (owner_id = auth.uid());

-- Los alérgenos de un ingrediente se ven y se tocan si el ingrediente se ve y se
-- toca. Desde la 0006 eso incluye el catálogo compartido.
create policy ingrediente_alergenos_leer on public.ingrediente_alergenos
  for select to authenticated
  using (exists (
    select 1 from public.ingredientes i
    where i.id = ingrediente_id and (i.owner_id is null or i.owner_id = auth.uid())
  ));

create policy ingrediente_alergenos_escribir on public.ingrediente_alergenos
  for all to authenticated
  using (exists (
    select 1 from public.ingredientes i
    where i.id = ingrediente_id and (i.owner_id is null or i.owner_id = auth.uid())
  ))
  with check (exists (
    select 1 from public.ingredientes i
    where i.id = ingrediente_id and (i.owner_id is null or i.owner_id = auth.uid())
  ));

-- Las alergias de una persona son de quien tiene a esa persona.
create policy persona_alergias_propias on public.persona_alergias
  for all to authenticated
  using (exists (
    select 1 from public.personas p
    where p.id = persona_id and p.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.personas p
    where p.id = persona_id and p.owner_id = auth.uid()
  ));

-- ------------------------------------------------------- los catorce -------
-- Anexo II del Reglamento (UE) 1169/2011. Se insertan una vez; relanzar la
-- migración no los duplica ni pisa lo que haya.

insert into public.alergenos (owner_id, codigo, nombre, detalle, estandar) values
  (null, 'gluten',         'Cereales con gluten',           'Trigo, centeno, cebada, avena, espelta, kamut', true),
  (null, 'crustaceos',     'Crustáceos',                    'Gamba, langostino, cangrejo, bogavante, cigala…', true),
  (null, 'huevos',         'Huevos',                        'Y lo que los lleva: mayonesa, tortilla, rebozados', true),
  (null, 'pescado',        'Pescado',                       'Incluidos surimi, huevas y aceite de hígado', true),
  (null, 'cacahuetes',     'Cacahuetes',                    'Y su aceite', true),
  (null, 'soja',           'Soja',                          'Tofu, tempeh, miso, lecitina, salsa de soja', true),
  (null, 'leche',          'Leche',                         'Incluida la lactosa: queso, yogur, nata, mantequilla', true),
  (null, 'frutos_cascara', 'Frutos de cáscara',             'Almendra, avellana, nuez, anacardo, pistacho, pecana, macadamia y nuez de Brasil. La castaña y el piñón no están en la lista', true),
  (null, 'apio',           'Apio',                          'Incluido el apionabo', true),
  (null, 'mostaza',        'Mostaza',                       null, true),
  (null, 'sesamo',         'Granos de sésamo',              'Tahini, gomasio, aceite de sésamo', true),
  (null, 'sulfitos',       'Dióxido de azufre y sulfitos',  'Por encima de 10 mg/kg: vino, vinagre, fruta desecada', true),
  (null, 'altramuces',     'Altramuces',                    null, true),
  (null, 'moluscos',       'Moluscos',                      'Mejillón, almeja, calamar, pulpo, caracol…', true)
on conflict (owner_id, codigo) do nothing;
