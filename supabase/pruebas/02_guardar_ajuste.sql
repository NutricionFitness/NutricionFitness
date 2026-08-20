-- Pruebas de la función que guarda un ajuste como nueva versión.
\set ON_ERROR_STOP on

set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';

-- --- 1. clona la dieta con los gramos nuevos --------------------------------
do $$
declare
  v_comp     uuid;
  v_nueva    uuid;
  v_padre    uuid := 'aaaaaaa1-0000-0000-0000-000000000002';
  n          integer;
  g          numeric;
  v_version  integer;
begin
  select c.id into v_comp
    from public.componentes c
    join public.comidas m on m.id = c.comida_id
   where m.dieta_id = v_padre limit 1;

  v_nueva := public.guardar_ajuste(
    v_padre,
    jsonb_build_array(jsonb_build_object('id', v_comp, 'gramos', 65)),
    'Dieta de Ana · 1700 kcal', 1700, 'prioridades',
    '{"holguraRel":0.4}'::jsonb, '{"avisos":[]}'::jsonb, 1900, 1701);

  assert v_nueva is not null, 'no devolvió id';

  select version into v_version from public.dietas where id = v_nueva;
  assert v_version = 2, format('la versión debería ser 2, es %s', v_version);

  select count(*) into n from public.dietas
   where id = v_nueva and dieta_padre_id = v_padre;
  assert n = 1, 'la dieta nueva no apunta a su madre';

  select count(*) into n from public.comidas where dieta_id = v_nueva;
  assert n = (select count(*) from public.comidas where dieta_id = v_padre),
    'no ha copiado todas las comidas';

  select c.gramos into g
    from public.componentes c join public.comidas m on m.id = c.comida_id
   where m.dieta_id = v_nueva limit 1;
  assert g = 65, format('los gramos nuevos no se han aplicado: %s', g);

  -- la dieta original no se toca
  select c.gramos into g
    from public.componentes c join public.comidas m on m.id = c.comida_id
   where m.dieta_id = v_padre limit 1;
  assert g = 100, format('¡ha modificado la dieta original! ahora vale %s', g);

  select count(*) into n from public.ajustes where dieta_resultado_id = v_nueva;
  assert n = 1, 'no ha quedado constancia en el historial';
end $$;

-- --- 2. no se puede clonar la dieta de otro ---------------------------------
do $$
declare ok boolean := false;
begin
  begin
    perform public.guardar_ajuste(
      'bbbbbbb1-0000-0000-0000-000000000002',
      jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'gramos', 10)));
  exception when others then ok := true;
  end;
  assert ok, 'FALLO: Ana ha podido clonar la dieta de Bruno';
end $$;

-- --- 3. entra todo o no entra nada ------------------------------------------
do $$
declare antes integer; despues integer; ok boolean := false;
begin
  select count(*) into antes from public.dietas;
  begin
    perform public.guardar_ajuste('aaaaaaa1-0000-0000-0000-000000000002', '[]'::jsonb);
  exception when others then ok := true;
  end;
  assert ok, 'FALLO: aceptó una lista de gramos vacía';
  select count(*) into despues from public.dietas;
  assert antes = despues,
    format('FALLO: ha dejado una dieta a medias (%s -> %s)', antes, despues);
end $$;

-- --- 4. los componentes que el ajuste no menciona se conservan --------------
do $$
declare v_nueva uuid; n integer;
begin
  insert into public.componentes (comida_id, ingrediente_id, gramos)
    select 'aaaaaaa1-0000-0000-0000-000000000003', id, 33
    from public.ingredientes where codigo_bedca = 'X2';

  v_nueva := public.guardar_ajuste(
    'aaaaaaa1-0000-0000-0000-000000000002',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'gramos', 999)));

  select count(*) into n
    from public.componentes c join public.comidas m on m.id = c.comida_id
   where m.dieta_id = v_nueva and c.gramos = 33;
  assert n = 1, 'un componente no mencionado en el ajuste debería conservar sus gramos';
end $$;

reset role;
select 'PRUEBAS DE guardar_ajuste OK' as resultado;
