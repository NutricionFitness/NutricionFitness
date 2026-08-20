-- Pruebas del linaje de versiones y de los totales por comida.
\set ON_ERROR_STOP on

set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';

-- Cadena de tres versiones sobre una dieta NUEVA.
--
-- A propósito no se reutiliza la dieta de Ana: las pruebas anteriores ya le han
-- colgado versiones, y una prueba que dependa de lo que hicieron las de antes
-- se rompe en cuanto alguien añade un caso. Cada prueba monta lo suyo.
do $$
declare
  v1 uuid; v2 uuid; v3 uuid; comida uuid; n integer; comp uuid;
begin
  insert into public.dietas (persona_id, nombre)
    values ('aaaaaaa1-0000-0000-0000-000000000001', 'Dieta para el linaje')
    returning id into v1;
  insert into public.comidas (dieta_id, nombre, orden)
    values (v1, 'Comida', 0) returning id into comida;
  insert into public.componentes (comida_id, ingrediente_id, gramos)
    select comida, id, 100 from public.ingredientes where codigo_bedca = 'X1';
  -- una comida vacía, para comprobar que sale igual en los totales
  insert into public.comidas (dieta_id, nombre, orden) values (v1, 'Cena', 1);

  select c.id into comp from public.componentes c
    join public.comidas m on m.id = c.comida_id where m.dieta_id = v1 limit 1;

  v2 := public.guardar_ajuste(v1, jsonb_build_array(jsonb_build_object('id', comp, 'gramos', 80)),
                              'v2', 1800, 'prioridades', '{}', '{}', 2000, 1801);
  select c.id into comp from public.componentes c
    join public.comidas m on m.id = c.comida_id where m.dieta_id = v2 limit 1;
  v3 := public.guardar_ajuste(v2, jsonb_build_array(jsonb_build_object('id', comp, 'gramos', 60)),
                              'v3', 1600, 'prioridades', '{}', '{}', 1800, 1601);

  -- --- desde la raíz se ve toda la familia -------------------------------
  select count(*) into n from public.linaje_dieta(v1);
  assert n = 3, format('desde la raíz deberían verse 3 versiones, se ven %s', n);

  -- --- y desde la última también, subiendo primero ------------------------
  select count(*) into n from public.linaje_dieta(v3);
  assert n = 3, format('desde la última deberían verse 3 versiones, se ven %s', n);

  -- --- desde la de en medio, igual ---------------------------------------
  select count(*) into n from public.linaje_dieta(v2);
  assert n = 3, format('desde la intermedia deberían verse 3, se ven %s', n);

  -- --- vienen ordenadas por versión --------------------------------------
  perform 1 from (
    select version, row_number() over (order by version) rn,
           row_number() over () orden_real
      from public.linaje_dieta(v3)
  ) t where rn <> orden_real;
  assert not found, 'el linaje no viene ordenado por versión';

  -- --- las profundidades son las esperadas -------------------------------
  select profundidad into n from public.linaje_dieta(v3) where id = v3;
  assert n = 2, format('v3 debería estar a profundidad 2, está a %s', n);
end $$;

-- --- el linaje respeta el control de acceso ---------------------------------
do $$
declare n integer;
begin
  select count(*) into n from public.linaje_dieta('bbbbbbb1-0000-0000-0000-000000000002');
  assert n = 0, 'FALLO: Ana ve el linaje de una dieta de Bruno';
end $$;

set app.usuario_actual = '22222222-2222-2222-2222-222222222222';
do $$
declare n integer;
begin
  select count(*) into n from public.linaje_dieta('aaaaaaa1-0000-0000-0000-000000000002');
  assert n = 0, 'FALLO: Bruno ve el linaje de una dieta de Ana';
end $$;

-- --- totales por comida -----------------------------------------------------
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';
do $$
declare v_kcal numeric; v_esperado numeric; n integer; v_dieta uuid;
begin
  select id into v_dieta from public.dietas
   where nombre = 'Dieta para el linaje' limit 1;

  select count(*) into n from public.v_comidas_totales where dieta_id = v_dieta;
  assert n = 2, format('deberían verse 2 comidas, se ven %s', n);

  select sum(kcal) into v_kcal from public.v_comidas_totales where dieta_id = v_dieta;
  select kcal into v_esperado from public.v_dietas_totales where dieta_id = v_dieta;
  assert abs(v_kcal - v_esperado) < 0.01,
    format('los totales por comida (%s) no suman el total del día (%s)', v_kcal, v_esperado);

  -- una comida vacía aparece con 0, no desaparece
  select count(*) into n from public.v_comidas_totales
   where dieta_id = v_dieta and n_componentes = 0;
  assert n = 1, 'la comida sin componentes debería salir igual, con 0';

  -- y no se ven las de otro
  select count(*) into n from public.v_comidas_totales
   where dieta_id = 'bbbbbbb1-0000-0000-0000-000000000002';
  assert n = 0, 'FALLO: se ven los totales por comida de una dieta ajena';
end $$;

reset role;
select 'PRUEBAS DE LINAJE Y TOTALES OK' as resultado;
