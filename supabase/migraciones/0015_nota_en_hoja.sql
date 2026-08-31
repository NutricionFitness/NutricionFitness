-- ============================================================================
-- 0015 · La nota de una dieta puede salir en la hoja
-- ============================================================================
--
-- Las notas por dieta y por persona **no necesitan columnas nuevas**:
-- `dietas.descripcion` y `personas.notas` están en el esquema desde la 0001 y
-- las acciones ya las aceptan; lo que faltaba era pantalla. Lo único que hace
-- falta guardar es una cosa que hasta ahora no se podía decir: **si esa nota
-- sale o no en el papel que recibe el cliente**.
--
-- Un solo interruptor, y no dos campos de notas, porque casi siempre la nota es
-- una sola —«2 L de agua al día»— y tener dos cajas obliga a decidir dos veces.
-- Con el interruptor, la misma nota vale para un recordatorio del cliente y
-- para un apunte interno.
--
-- **Nace apagado**, también en las dietas que ya existen. Es la regla de la
-- fase 19: nada que publique algo hacia fuera se enciende solo. Una dieta
-- guardada hace un mes puede tener en `descripcion` un apunte que no se escribió
-- para que lo leyera nadie, y encenderlo por defecto lo imprimiría.
--
-- Y hay que **copiarlo al versionar y al duplicar**: los `insert` de
-- `guardar_ajuste` y `duplicar_dieta` van con la lista de columnas escrita a
-- mano, así que una columna nueva no viaja sola. Sin esto, guardar un ajuste
-- apagaría la nota sin decir nada. Es lo mismo que pasó con las opciones en la
-- 0012, y por eso las dos funciones se reescriben aquí, en la misma migración
-- que la columna.
--
-- Idempotente: se puede volver a aplicar.
-- ============================================================================

alter table public.dietas
  add column if not exists nota_en_hoja boolean not null default false;

comment on column public.dietas.descripcion is
  'La nota de la dieta. Sale en la hoja impresa solo si `nota_en_hoja`.';
comment on column public.dietas.nota_en_hoja is
  'Si la nota se imprime en la hoja que recibe el cliente. Apagado por defecto: '
  'lo que se escribió sin saber que se iba a imprimir, no se imprime.';

-- ---------------------------------------------------------------------------
-- guardar_ajuste: igual que en la 0012, más la nota
-- ---------------------------------------------------------------------------
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
    owner_id, persona_id, nombre, descripcion, nota_en_hoja, modelo_energia,
    estado_cantidades, kcal_objetivo, version, dieta_padre_id)
  values (
    v_padre.owner_id, v_padre.persona_id,
    coalesce(nullif(trim(p_nombre), ''),
             v_padre.nombre || ' · ' || round(coalesce(p_kcal_objetivo, 0)) || ' kcal'),
    v_padre.descripcion, v_padre.nota_en_hoja,
    v_padre.modelo_energia, v_padre.estado_cantidades,
    p_kcal_objetivo, v_padre.version + 1, v_padre.id)
  returning id into v_nueva_id;

  for v_comida in
    select * from public.comidas where dieta_id = p_dieta_id order by orden, nombre
  loop
    insert into public.comidas (dieta_id, nombre, orden)
    values (v_nueva_id, v_comida.nombre, v_comida.orden)
    returning id into v_nueva_comida_id;

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

-- ---------------------------------------------------------------------------
-- duplicar_dieta: la de la 0013, más la nota
-- ---------------------------------------------------------------------------
create or replace function public.duplicar_dieta(
  p_dieta_id uuid, p_nombre text default null, p_persona_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_origen  public.dietas%rowtype;
  v_nueva   uuid;
  v_comida  record;
  v_nueva_comida uuid;
  v_persona_owner uuid;
begin
  select * into v_origen from public.dietas where id = p_dieta_id;
  if not found then
    raise exception 'La dieta % no existe o no es tuya', p_dieta_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_persona_id is not null then
    select p.owner_id into v_persona_owner
      from public.personas p where p.id = p_persona_id;
    if v_persona_owner is null or v_persona_owner <> v_origen.owner_id then
      raise exception 'La persona % no existe o no es tuya', p_persona_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.dietas (
    owner_id, persona_id, nombre, descripcion, nota_en_hoja, modelo_energia,
    estado_cantidades, kcal_objetivo, version, dieta_padre_id)
  values (
    v_origen.owner_id,
    coalesce(p_persona_id, v_origen.persona_id),
    coalesce(nullif(trim(p_nombre), ''), v_origen.nombre || ' (copia)'),
    v_origen.descripcion, v_origen.nota_en_hoja,
    v_origen.modelo_energia, v_origen.estado_cantidades,
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
