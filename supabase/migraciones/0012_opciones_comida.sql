-- ---------------------------------------------------------------------------
-- 0012 — Opciones dentro de una comida
--
-- El caso: una dieta tiene un desayuno, pero el cliente no desayuna lo mismo
-- todos los días. Hasta ahora eso obligaba a duplicar la dieta entera y a
-- mantener las dos a mano. Ahora una comida puede tener varias **opciones**, se
-- cambia de una a otra con un botón, y la dieta sigue siendo la misma dieta.
--
-- ## Por qué una tabla y no una columna
--
-- La alternativa barata era `componentes.opcion smallint` más
-- `comidas.opcion_activa smallint`: sin tabla nueva, sin `join`. Se descartó
-- porque una opción quiere **nombre** —«con huevo», «vegetariana»— y con un
-- número no se puede tener. Para quien monta dietas, «Opción 2» no dice nada y
-- «Con tortilla» lo dice todo.
--
-- ## Lo que sostiene todo lo demás: son equivalentes
--
-- Las opciones de una comida tienen que valer lo mismo en kilocalorías y en
-- reparto de macros. No es un capricho: si no lo fueran, «las kcal de la dieta»
-- dejarían de significar nada —dependerían de qué combinación esté activa— y
-- el ajuste, el historial y la hoja impresa se quedarían sin suelo.
--
-- La regla NO se impone aquí. Una restricción en la base tendría que sumar
-- macros de todos los componentes en cada `insert`, y sobre todo dejaría a
-- medio montar una opción imposible de guardar: se empieza poniendo un
-- alimento, y con uno solo nunca cuadra. La comprueba la aplicación cuando la
-- opción está terminada, avisa de en qué falla, y ofrece cuadrarla con el
-- motor. Lo que sí guarda la base es **qué opción es la referencia**, que es la
-- primera por orden.
--
-- ## El relleno
--
-- Cada comida que ya existe se convierte en su «Opción 1» y sus componentes
-- pasan a colgar de ella. Después de eso `componentes.opcion_id` es obligatoria:
-- un componente sin opción no lo puede ver nadie.
-- ---------------------------------------------------------------------------

create table if not exists public.opciones (
  id        uuid primary key default gen_random_uuid(),
  comida_id uuid not null references public.comidas(id) on delete cascade,
  nombre    text not null check (length(trim(nombre)) > 0),
  orden     integer not null default 0,
  creado_en timestamptz not null default now(),
  unique (comida_id, nombre)
);

create index if not exists opciones_comida on public.opciones (comida_id);

-- ---------------------------------------------------------------------------
-- Los componentes cuelgan de una opción, no de la comida
--
-- `comida_id` se queda: es redundante con `opciones.comida_id`, pero lo usan la
-- política de acceso y media docena de consultas, y quitarlo sería reescribir
-- cosas que funcionan a cambio de nada. Un disparador lo mantiene a raya.
-- ---------------------------------------------------------------------------
alter table public.componentes
  add column if not exists opcion_id uuid references public.opciones(id) on delete cascade;

-- Cuál se está viendo. `set null` al borrarla: la pantalla cae en la primera.
alter table public.comidas
  add column if not exists opcion_activa_id uuid
    references public.opciones(id) on delete set null;

-- --- relleno ---------------------------------------------------------------
do $$
declare m record;
        nueva uuid;
begin
  for m in select id from public.comidas loop
    -- Idempotente: si ya tiene opciones, esta migración ya pasó por aquí.
    if exists (select 1 from public.opciones o where o.comida_id = m.id) then
      continue;
    end if;

    insert into public.opciones (comida_id, nombre, orden)
    values (m.id, 'Opción 1', 0)
    returning id into nueva;

    update public.componentes set opcion_id = nueva
     where comida_id = m.id and opcion_id is null;

    update public.comidas set opcion_activa_id = nueva where id = m.id;
  end loop;
end $$;

-- Después del relleno, obligatoria.
alter table public.componentes alter column opcion_id set not null;

create index if not exists componentes_opcion on public.componentes (opcion_id);

-- ---------------------------------------------------------------------------
-- La opción y el componente tienen que ser de la misma comida
--
-- Sin esto, un `update` mal escrito podría colgar un componente del desayuno de
-- una opción de la cena, y el error no se vería: la comida seguiría sumando
-- bien por un lado y mal por otro. Es el tipo de incoherencia que no da error
-- nunca y que se descubre meses después con un total que no cuadra.
-- ---------------------------------------------------------------------------
create or replace function public.componente_opcion_coherente()
returns trigger
language plpgsql
as $$
declare comida_de_la_opcion uuid;
begin
  select o.comida_id into comida_de_la_opcion
    from public.opciones o where o.id = new.opcion_id;

  if comida_de_la_opcion is null then
    raise exception 'la opción % no existe', new.opcion_id;
  end if;
  if comida_de_la_opcion <> new.comida_id then
    raise exception
      'el componente dice ser de la comida % y su opción es de la %',
      new.comida_id, comida_de_la_opcion;
  end if;
  return new;
end $$;

drop trigger if exists componentes_opcion_coherente on public.componentes;
create trigger componentes_opcion_coherente
  before insert or update of opcion_id, comida_id on public.componentes
  for each row execute function public.componente_opcion_coherente();

-- Y la opción activa de una comida tiene que ser suya.
create or replace function public.comida_opcion_activa_coherente()
returns trigger
language plpgsql
as $$
declare de_quien uuid;
begin
  if new.opcion_activa_id is null then return new; end if;
  select o.comida_id into de_quien from public.opciones o where o.id = new.opcion_activa_id;
  if de_quien is distinct from new.id then
    raise exception 'la opción activa % no es de esta comida', new.opcion_activa_id;
  end if;
  return new;
end $$;

drop trigger if exists comidas_opcion_activa_coherente on public.comidas;
create trigger comidas_opcion_activa_coherente
  before insert or update of opcion_activa_id on public.comidas
  for each row execute function public.comida_opcion_activa_coherente();

-- ---------------------------------------------------------------------------
-- Acceso: igual que comidas y componentes, cuelga de la dieta
-- ---------------------------------------------------------------------------
alter table public.opciones enable row level security;

create policy opciones_de_mis_dietas on public.opciones
  for all to authenticated
  using (exists (select 1 from public.comidas m join public.dietas d on d.id = m.dieta_id
                 where m.id = opciones.comida_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.comidas m join public.dietas d on d.id = m.dieta_id
                      where m.id = opciones.comida_id and d.owner_id = auth.uid()));

grant select, insert, update, delete on public.opciones to authenticated;

-- ---------------------------------------------------------------------------
-- Una comida nunca se queda sin opciones
--
-- Borrar la última dejaría una comida con cero opciones y, por tanto, sin sitio
-- donde poner un ingrediente. La pantalla no lo ofrece, pero la regla vive
-- aquí, que es donde no se puede saltar por accidente.
-- ---------------------------------------------------------------------------
create or replace function public.no_borrar_ultima_opcion()
returns trigger
language plpgsql
as $$
begin
  -- Si la comida entera se va, sus opciones se van con ella: eso sí vale.
  if not exists (select 1 from public.comidas m where m.id = old.comida_id) then
    return old;
  end if;
  if (select count(*) from public.opciones o where o.comida_id = old.comida_id) <= 1 then
    raise exception 'una comida no puede quedarse sin opciones';
  end if;
  return old;
end $$;

drop trigger if exists opciones_no_borrar_ultima on public.opciones;
create trigger opciones_no_borrar_ultima
  before delete on public.opciones
  for each row execute function public.no_borrar_ultima_opcion();

-- ---------------------------------------------------------------------------
-- Crear una comida crea su primera opción
--
-- Antes de esto había que acordarse en cada sitio que inserta una comida
-- —`AnadirComida`, `duplicar_dieta`, `crear_dieta_inicial`—. Acordarse en tres
-- sitios es olvidarse en uno.
-- ---------------------------------------------------------------------------
create or replace function public.comida_con_su_opcion()
returns trigger
language plpgsql
as $$
declare nueva uuid;
begin
  insert into public.opciones (comida_id, nombre, orden)
  values (new.id, 'Opción 1', 0)
  returning id into nueva;

  update public.comidas set opcion_activa_id = nueva where id = new.id;
  return new;
end $$;

drop trigger if exists comidas_con_su_opcion on public.comidas;
create trigger comidas_con_su_opcion
  after insert on public.comidas
  for each row execute function public.comida_con_su_opcion();

comment on table public.opciones is
  'Alternativas de una misma comida. Deben valer lo mismo en kcal y macros; '
  'la referencia es la de menor `orden` y la comprobación la hace la app.';

-- ---------------------------------------------------------------------------
-- Copiar una comida es copiar sus opciones
--
-- `guardar_ajuste` y `duplicar_dieta` copiaban comidas y componentes. Con
-- `componentes.opcion_id` obligatoria, las dos se rompen: no hay opción a la
-- que colgar la copia. Tienen que entrar en la MISMA migración que la columna,
-- porque entre una y otra la app estaría rota.
--
-- Las dos hacen ahora lo mismo por dentro, y por eso está aquí una sola vez:
-- copian las opciones de una comida a otra, con sus componentes, y devuelven
-- cuál es la copia de la que estaba activa.
--
-- El detalle que no es obvio: la comida nueva **ya trae** su «Opción 1» por el
-- disparador de arriba. Insertar otra con ese nombre chocaría contra el único
-- `(comida_id, nombre)`. Así que la primera opción no se inserta: se
-- **renombra** la que ya hay. Sale gratis y deja la garantía en pie —ninguna
-- comida existe sin opciones ni un instante—.
-- ---------------------------------------------------------------------------
create or replace function public.copiar_opciones(
  p_comida_origen uuid,
  p_comida_destino uuid,
  -- Gramos nuevos por componente, como los manda `guardar_ajuste`. Nulo = tal cual.
  p_gramos jsonb default null
) returns uuid                    -- la copia de la opción que estaba activa
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_op        record;
  v_nueva_op  uuid;
  v_activa_origen uuid;
  v_activa_copia  uuid;
  v_primera   boolean := true;
begin
  select opcion_activa_id into v_activa_origen
    from public.comidas where id = p_comida_origen;

  for v_op in
    select * from public.opciones where comida_id = p_comida_origen
     order by orden, creado_en, id
  loop
    if v_primera then
      -- La que creó el disparador al insertar la comida destino.
      update public.opciones
         set nombre = v_op.nombre, orden = v_op.orden
       where comida_id = p_comida_destino
       returning id into v_nueva_op;
      v_primera := false;
    else
      insert into public.opciones (comida_id, nombre, orden)
      values (p_comida_destino, v_op.nombre, v_op.orden)
      returning id into v_nueva_op;
    end if;

    insert into public.componentes (
      comida_id, opcion_id, ingrediente_id, gramos, orden, bloqueado, prioridad,
      min_g, max_g, paso_g)
    select
      p_comida_destino, v_nueva_op, c.ingrediente_id,
      case
        when p_gramos is null then c.gramos
        else coalesce((select (g->>'gramos')::numeric
                       from jsonb_array_elements(p_gramos) g
                       where (g->>'id')::uuid = c.id), c.gramos)
      end,
      c.orden, c.bloqueado, c.prioridad, c.min_g, c.max_g, c.paso_g
    from public.componentes c
    where c.opcion_id = v_op.id;

    if v_op.id = v_activa_origen then
      v_activa_copia := v_nueva_op;
    end if;
  end loop;

  -- Si la de origen no tenía activa marcada, se activa la primera.
  if v_activa_copia is null then
    select id into v_activa_copia from public.opciones
     where comida_id = p_comida_destino order by orden, creado_en, id limit 1;
  end if;

  update public.comidas set opcion_activa_id = v_activa_copia
   where id = p_comida_destino;

  return v_activa_copia;
end $$;

grant execute on function public.copiar_opciones(uuid, uuid, jsonb) to authenticated;

-- --- guardar_ajuste, con opciones -----------------------------------------
create or replace function public.guardar_ajuste(
  p_dieta_id      uuid,
  p_gramos        jsonb,
  p_nombre        text default null,
  p_kcal_objetivo numeric default null,
  p_modo          text    default 'prioridades',
  p_parametros    jsonb   default '{}'::jsonb,
  p_resultado     jsonb   default '{}'::jsonb,
  p_kcal_origen   numeric default null,
  p_kcal_final    numeric default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_padre    public.dietas%rowtype;
  v_nueva_id uuid;
  v_comida   record;
  v_nueva_comida_id uuid;
begin
  select * into v_padre from public.dietas where id = p_dieta_id;
  if not found then
    raise exception 'La dieta % no existe o no es tuya', p_dieta_id
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_gramos) <> 'array' or jsonb_array_length(p_gramos) = 0 then
    raise exception 'Hacen falta los gramos de al menos un componente';
  end if;

  insert into public.dietas (
    owner_id, persona_id, nombre, descripcion, modelo_energia, estado_cantidades,
    kcal_objetivo, version, dieta_padre_id)
  values (
    v_padre.owner_id, v_padre.persona_id,
    coalesce(nullif(trim(p_nombre), ''),
             v_padre.nombre || ' · ' || round(coalesce(p_kcal_objetivo, 0)) || ' kcal'),
    v_padre.descripcion, v_padre.modelo_energia, v_padre.estado_cantidades,
    p_kcal_objetivo, v_padre.version + 1, v_padre.id)
  returning id into v_nueva_id;

  for v_comida in
    select * from public.comidas where dieta_id = p_dieta_id order by orden, nombre
  loop
    insert into public.comidas (dieta_id, nombre, orden)
    values (v_nueva_id, v_comida.nombre, v_comida.orden)
    returning id into v_nueva_comida_id;

    -- Copia TODAS las opciones, no solo la activa: el ajuste las cuadra todas
    -- —lo hace el motor en el cliente y llegan aquí en `p_gramos`— y una
    -- versión guardada que perdiera las alternativas no sería la misma dieta.
    perform public.copiar_opciones(v_comida.id, v_nueva_comida_id, p_gramos);
  end loop;

  insert into public.ajustes (
    owner_id, dieta_id, dieta_resultado_id, kcal_origen, kcal_objetivo,
    kcal_final, modo, parametros, resultado, factible)
  values (
    v_padre.owner_id, p_dieta_id, v_nueva_id,
    coalesce(p_kcal_origen, 0), coalesce(p_kcal_objetivo, 0), p_kcal_final,
    p_modo, p_parametros, p_resultado, true);

  return v_nueva_id;
end $$;

grant execute on function public.guardar_ajuste(
  uuid, jsonb, text, numeric, text, jsonb, jsonb, numeric, numeric) to authenticated;

-- --- duplicar_dieta, con opciones ------------------------------------------
create or replace function public.duplicar_dieta(
  p_dieta_id   uuid,
  p_nombre     text default null,
  p_persona_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_origen  public.dietas%rowtype;
  v_nueva   uuid;
  v_comida  record;
  v_nueva_comida uuid;
begin
  select * into v_origen from public.dietas where id = p_dieta_id;
  if not found then
    raise exception 'La dieta % no existe o no es tuya', p_dieta_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.dietas (
    owner_id, persona_id, nombre, descripcion, modelo_energia,
    estado_cantidades, kcal_objetivo, version, dieta_padre_id)
  values (
    v_origen.owner_id,
    coalesce(p_persona_id, v_origen.persona_id),
    coalesce(nullif(trim(p_nombre), ''), v_origen.nombre || ' (copia)'),
    v_origen.descripcion, v_origen.modelo_energia, v_origen.estado_cantidades,
    v_origen.kcal_objetivo,
    1, null)
  returning id into v_nueva;

  for v_comida in
    select * from public.comidas where dieta_id = p_dieta_id order by orden, nombre
  loop
    insert into public.comidas (dieta_id, nombre, orden)
    values (v_nueva, v_comida.nombre, v_comida.orden)
    returning id into v_nueva_comida;

    perform public.copiar_opciones(v_comida.id, v_nueva_comida, null);
  end loop;

  return v_nueva;
end $$;

grant execute on function public.duplicar_dieta(uuid, text, uuid) to authenticated;
