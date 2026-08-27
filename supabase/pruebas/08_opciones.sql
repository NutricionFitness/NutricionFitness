-- ============================================================================
-- Pruebas de las opciones por comida (migración 0012).
--
--   psql -d appnut -f supabase/pruebas/00_stub_auth.sql
--   psql -d appnut -f supabase/migraciones/0001_esquema.sql
--   ... 0002 a 0005 ...
--   psql -d appnut -f supabase/migraciones/0012_opciones_comida.sql
--   psql -d appnut -f supabase/pruebas/08_opciones.sql
--
-- Lo que hay que demostrar, por orden de gravedad:
--
--   1. que el relleno no ha perdido ni un componente,
--   2. que `guardar_ajuste` y `duplicar_dieta` —que copiaban comidas y
--      componentes y ahora tienen que copiar opciones— **siguen funcionando**,
--      que es donde esta migración podía romper la app sin avisar,
--   3. que las reglas nuevas se cumplen: una comida nunca sin opciones, una
--      opción nunca de otra comida,
--   4. y que el acceso sigue cerrado.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off
set client_min_messages = warning;

-- --- montaje ---------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'luis@ejemplo.es')
on conflict do nothing;

-- `id` es GENERATED ALWAYS, así que se fuerza: las pruebas de abajo se leen
-- mucho mejor con identificadores fijos que buscando por nombre cada vez.
insert into public.ingredientes
  (id, owner_id, codigo_bedca, nombre, nombre_norm, grupo, estado,
   prot_100, hc_100, grasa_100, fibra_100, alcohol_100, preferente)
overriding system value
values
  (900001, null, 'O001', 'Arroz de prueba', 'arroz de prueba', 'Cereales y derivados',
   'crudo', 7, 78, 0.6, 1.3, 0, true),
  (900002, null, 'O002', 'Pasta de prueba', 'pasta de prueba', 'Cereales y derivados',
   'crudo', 12, 74, 1.5, 3, 0, true),
  (900003, null, 'O003', 'Pollo de prueba', 'pollo de prueba', 'Carnes y derivados',
   'crudo', 22, 0, 2.5, 0, 0, true)
on conflict (id) do nothing;

set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';

insert into public.dietas (id, persona_id, nombre)
values ('aaaaaaaa-0000-0000-0000-000000000001', null, 'Dieta con opciones');

insert into public.comidas (id, dieta_id, nombre, orden) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Desayuno', 0),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Cena', 1);

-- ===========================================================================
-- 1. Crear una comida crea su primera opción, y la deja activa
--
-- Sin esto habría que acordarse en cada sitio que inserta una comida, y una
-- comida sin opciones no tiene dónde poner un ingrediente.
-- ===========================================================================
do $$
declare n integer; act uuid;
begin
  select count(*) into n from public.opciones
   where comida_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  assert n = 1, format('FALLO: la comida nueva debería tener 1 opción, tiene %s', n);

  select opcion_activa_id into act from public.comidas
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  assert act is not null, 'FALLO: la comida nueva no tiene opción activa';
end $$;

-- Componentes en la opción que hay.
insert into public.componentes (comida_id, opcion_id, ingrediente_id, gramos, orden)
select 'bbbbbbbb-0000-0000-0000-000000000001', o.id, 900001, 90, 0
  from public.opciones o where o.comida_id = 'bbbbbbbb-0000-0000-0000-000000000001';

insert into public.componentes (comida_id, opcion_id, ingrediente_id, gramos, orden)
select 'bbbbbbbb-0000-0000-0000-000000000002', o.id, 900003, 150, 0
  from public.opciones o where o.comida_id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- Una segunda opción del desayuno, con otro alimento.
insert into public.opciones (id, comida_id, nombre, orden)
values ('cccccccc-0000-0000-0000-000000000002',
        'bbbbbbbb-0000-0000-0000-000000000001', 'Con pasta', 1);

insert into public.componentes (comida_id, opcion_id, ingrediente_id, gramos, orden)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002',
        900002, 85, 0);

-- ===========================================================================
-- 2. Una opción no puede llevarse componentes de otra comida
-- ===========================================================================
do $$
begin
  begin
    insert into public.componentes (comida_id, opcion_id, ingrediente_id, gramos, orden)
    values ('bbbbbbbb-0000-0000-0000-000000000002',   -- Cena
            'cccccccc-0000-0000-0000-000000000002',   -- opción del Desayuno
            900001, 50, 0);
    raise exception 'FALLO GRAVE: un componente de la cena cuelga de una opción del desayuno';
  exception
    when raise_exception then
      if sqlerrm like 'FALLO GRAVE%' then raise; end if;   -- el nuestro pasa
  end;
end $$;

-- Y la opción activa de una comida tiene que ser suya.
do $$
begin
  begin
    update public.comidas set opcion_activa_id = 'cccccccc-0000-0000-0000-000000000002'
     where id = 'bbbbbbbb-0000-0000-0000-000000000002';
    raise exception 'FALLO GRAVE: la cena puede activar una opción del desayuno';
  exception
    when raise_exception then
      if sqlerrm like 'FALLO GRAVE%' then raise; end if;
  end;
end $$;

-- ===========================================================================
-- 3. Una comida no se queda sin opciones
-- ===========================================================================
do $$
declare unica uuid;
begin
  select id into unica from public.opciones
   where comida_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  begin
    delete from public.opciones where id = unica;
    raise exception 'FALLO GRAVE: se ha podido borrar la última opción de una comida';
  exception
    when raise_exception then
      if sqlerrm like 'FALLO GRAVE%' then raise; end if;
  end;
end $$;

-- Pero borrar una de dos sí vale, y se lleva sus componentes.
do $$
declare n integer;
begin
  delete from public.opciones where id = 'cccccccc-0000-0000-0000-000000000002';
  select count(*) into n from public.componentes
   where opcion_id = 'cccccccc-0000-0000-0000-000000000002';
  assert n = 0, 'FALLO: borrar una opción deja sus componentes sueltos';
  select count(*) into n from public.opciones
   where comida_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  assert n = 1, 'FALLO: no se ha borrado la opción';
end $$;

-- Se vuelve a poner, que hace falta abajo.
insert into public.opciones (id, comida_id, nombre, orden)
values ('cccccccc-0000-0000-0000-000000000002',
        'bbbbbbbb-0000-0000-0000-000000000001', 'Con pasta', 1);
insert into public.componentes (comida_id, opcion_id, ingrediente_id, gramos, orden)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002',
        900002, 85, 0);

-- ===========================================================================
-- 4. Borrar la comida entera SÍ se lleva sus opciones
-- ===========================================================================
do $$
declare n integer;
begin
  insert into public.comidas (id, dieta_id, nombre, orden)
  values ('bbbbbbbb-0000-0000-0000-00000000000f',
          'aaaaaaaa-0000-0000-0000-000000000001', 'Provisional', 9);
  delete from public.comidas where id = 'bbbbbbbb-0000-0000-0000-00000000000f';
  select count(*) into n from public.opciones
   where comida_id = 'bbbbbbbb-0000-0000-0000-00000000000f';
  assert n = 0, 'FALLO: borrar la comida deja sus opciones huérfanas';
end $$;

-- ===========================================================================
-- 5. duplicar_dieta copia TODAS las opciones, con su activa
--
-- Aquí es donde la 0012 podía romper la app en silencio: la función copiaba
-- componentes sin `opcion_id`, que ahora es obligatoria.
-- ===========================================================================
do $$
declare v_copia uuid;
        n integer;
        v_desayuno uuid;
        v_activa uuid;
        v_nombre text;
begin
  v_copia := public.duplicar_dieta('aaaaaaaa-0000-0000-0000-000000000001', 'La copia', null);

  select count(*) into n from public.comidas where dieta_id = v_copia;
  assert n = 2, format('FALLO: la copia tiene %s comidas y debería tener 2', n);

  select id into v_desayuno from public.comidas
   where dieta_id = v_copia and nombre = 'Desayuno';

  select count(*) into n from public.opciones where comida_id = v_desayuno;
  assert n = 2, format('FALLO: el desayuno copiado tiene %s opciones y debería tener 2', n);

  -- Los nombres, no solo el número.
  select count(*) into n from public.opciones
   where comida_id = v_desayuno and nombre in ('Opción 1', 'Con pasta');
  assert n = 2, 'FALLO: la copia ha perdido los nombres de las opciones';

  -- Y los componentes de cada una.
  select count(*) into n from public.componentes c
    join public.opciones o on o.id = c.opcion_id
   where o.comida_id = v_desayuno;
  assert n = 2, format('FALLO: el desayuno copiado tiene %s componentes, esperaba 2', n);

  -- La activa se copia, no se pierde.
  select opcion_activa_id into v_activa from public.comidas where id = v_desayuno;
  assert v_activa is not null, 'FALLO: la copia no tiene opción activa';
  select nombre into v_nombre from public.opciones where id = v_activa;
  assert v_nombre = 'Opción 1',
    format('FALLO: la activa copiada es «%s» y debería ser «Opción 1»', v_nombre);

  -- Y ninguna opción de la copia apunta a la comida original.
  select count(*) into n from public.opciones o
    join public.comidas m on m.id = o.comida_id
   where o.comida_id = v_desayuno and m.dieta_id <> v_copia;
  assert n = 0, 'FALLO GRAVE: una opción de la copia cuelga de la dieta original';
end $$;

-- Y con la activa cambiada, la copia respeta cuál era.
do $$
declare v_copia uuid; v_desayuno uuid; v_activa uuid; v_nombre text;
begin
  update public.comidas set opcion_activa_id = 'cccccccc-0000-0000-0000-000000000002'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';

  v_copia := public.duplicar_dieta('aaaaaaaa-0000-0000-0000-000000000001', 'Copia 2', null);
  select id into v_desayuno from public.comidas
   where dieta_id = v_copia and nombre = 'Desayuno';
  select opcion_activa_id into v_activa from public.comidas where id = v_desayuno;
  select nombre into v_nombre from public.opciones where id = v_activa;
  assert v_nombre = 'Con pasta',
    format('FALLO: se copió como activa «%s» y la original tenía «Con pasta»', v_nombre);
end $$;

-- ===========================================================================
-- 6. guardar_ajuste versiona con las opciones, y aplica los gramos nuevos
-- ===========================================================================
do $$
declare v_comp_arroz uuid;
        v_comp_pasta uuid;
        v_version uuid;
        v_desayuno uuid;
        n integer;
        g numeric;
begin
  select c.id into v_comp_arroz from public.componentes c
    join public.opciones o on o.id = c.opcion_id
   where o.comida_id = 'bbbbbbbb-0000-0000-0000-000000000001'
     and c.ingrediente_id = 900001;
  select c.id into v_comp_pasta from public.componentes c
   where c.opcion_id = 'cccccccc-0000-0000-0000-000000000002';

  -- Se ajustan LAS DOS opciones a la vez, que es lo que hace la app.
  v_version := public.guardar_ajuste(
    'aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object('id', v_comp_arroz, 'gramos', 120),
      jsonb_build_object('id', v_comp_pasta, 'gramos', 111)),
    'Versión con opciones', 1800);

  select id into v_desayuno from public.comidas
   where dieta_id = v_version and nombre = 'Desayuno';

  select count(*) into n from public.opciones where comida_id = v_desayuno;
  assert n = 2, format('FALLO: la versión tiene %s opciones en el desayuno, esperaba 2', n);

  select c.gramos into g from public.componentes c
    join public.opciones o on o.id = c.opcion_id
   where o.comida_id = v_desayuno and c.ingrediente_id = 900001;
  assert g = 120, format('FALLO: el arroz de la versión pesa %s y debería pesar 120', g);

  select c.gramos into g from public.componentes c
    join public.opciones o on o.id = c.opcion_id
   where o.comida_id = v_desayuno and c.ingrediente_id = 900002;
  assert g = 111,
    format('FALLO: la pasta de la opción NO activa pesa %s y debería pesar 111', g);

  -- Un componente que el ajuste no traiga se queda como estaba.
  select c.gramos into g from public.componentes c
    join public.opciones o on o.id = c.opcion_id
    join public.comidas m on m.id = o.comida_id
   where m.dieta_id = v_version and m.nombre = 'Cena';
  assert g = 150, format('FALLO: el pollo de la cena pesa %s y no se tocó', g);
end $$;

-- ===========================================================================
-- 7. Ninguna dieta queda con componentes sin opción
--
-- La comprobación que valida el relleno y todo lo de arriba de una vez.
-- ===========================================================================
do $$
declare n integer;
begin
  select count(*) into n from public.componentes where opcion_id is null;
  assert n = 0, format('FALLO GRAVE: hay %s componentes sin opción', n);

  select count(*) into n from public.comidas m
   where not exists (select 1 from public.opciones o where o.comida_id = m.id);
  assert n = 0, format('FALLO GRAVE: hay %s comidas sin ninguna opción', n);

  -- Y ningún componente en una opción de otra comida.
  select count(*) into n from public.componentes c
    join public.opciones o on o.id = c.opcion_id
   where o.comida_id <> c.comida_id;
  assert n = 0, format('FALLO GRAVE: hay %s componentes en la opción de otra comida', n);
end $$;

-- ===========================================================================
-- 8. El acceso sigue cerrado: Luis no ve ni toca las opciones de Ana
-- ===========================================================================
set app.usuario_actual = '22222222-2222-2222-2222-222222222222';

do $$
declare n integer;
begin
  select count(*) into n from public.opciones
   where comida_id = 'bbbbbbbb-0000-0000-0000-000000000001';
  assert n = 0, format('FALLO GRAVE: Luis ve %s opciones de la dieta de Ana', n);

  begin
    update public.opciones set nombre = 'Mía'
     where comida_id = 'bbbbbbbb-0000-0000-0000-000000000001';
    -- El RLS filtra en vez de dar error: lo que importa es que no cambie nada.
  exception when others then null;
  end;
end $$;

set app.usuario_actual = '11111111-1111-1111-1111-111111111111';
do $$
declare n integer;
begin
  select count(*) into n from public.opciones
   where comida_id = 'bbbbbbbb-0000-0000-0000-000000000001' and nombre = 'Mía';
  assert n = 0, 'FALLO GRAVE: Luis ha renombrado una opción de Ana';
end $$;

reset role;
reset app.usuario_actual;

select '08_opciones: TODO CORRECTO' as resultado;
