# Fase 4 — Supabase y la aplicación

La app completa: esquema con control de acceso, catálogo de ingredientes,
autenticación y las pantallas de personas, dietas y ajuste.

**El motor corre en el navegador.** Mover el control de kilocalorías no consulta
al servidor: recalcula el ajuste entero y pinta la propuesta al momento.

```
npm install
cp .env.example .env.local        # y rellenas las claves de Supabase
npm run cargar-ingredientes       # sube los 2.157 ingredientes (una vez)
npm run dev
```

---

## Puesta en marcha, paso a paso

### 1. Proyecto en Supabase

En [supabase.com](https://supabase.com), proyecto nuevo. **Elige región europea**
(Frankfurt o Ireland): vas a guardar dietas de personas identificadas desde
España, y tenerlo en la UE te ahorra toda una conversación sobre transferencias
internacionales de datos.

### 2. Migraciones

En el **SQL Editor** de Supabase, ejecuta en este orden:

1. `supabase/migraciones/0001_esquema.sql`
2. `supabase/migraciones/0002_guardar_ajuste.sql`
3. `supabase/migraciones/0003_linaje.sql`
4. `supabase/migraciones/0004_medidas.sql`

Si ya tenías la base creada de antes, te basta con ejecutar la que falte: cada
migración es independiente y se puede volver a ejecutar sin romper nada.

No ejecutes nada de `supabase/pruebas/`: eso es el andamio para probar en local.

### 3. Claves

De **Project Settings → API** a tu `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

La `service_role` **solo** la usa el script de carga. Nunca va al navegador ni
al repositorio: se salta el control de acceso por diseño.

### 4. Catálogo de ingredientes

```
npm run cargar-ingredientes
npm run cargar-medidas
```

El primero sube los 2.157 ingredientes utilizables de la fase 1 con `owner_id` nulo, que es
como se marca el catálogo compartido: lo lee cualquiera que haya entrado, no lo
modifica nadie. Es idempotente, puedes relanzarlo.

Al terminar comprueba que la base calcula bien la energía de un ingrediente
conocido. Si eso falla, algo se ha cargado mal y lo dice.

El segundo siembra **472 medidas caseras** (1 huevo = 53 g, 1 cucharada de
aceite = 9 g…) y **25 equivalencias crudo↔cocido**. Te dirá también qué
equivalencias ha descartado y por qué; conviene leerlo.

### 5. Tu usuario

La app entra con **correo y contraseña**. El registro público está cerrado a
propósito: es tu herramienta de trabajo, no un servicio abierto.

En Supabase, **Authentication → Providers → Email**:

- *Enable Email provider*: activado.
- *Confirm email*: puedes dejarlo activado; da igual, porque el usuario lo vas a
  crear tú ya confirmado.

En **Authentication → Users → Add user → Create new user**:

- Correo y contraseña.
- Marca **Auto Confirm User**. Si no lo marcas, no podrás entrar hasta confirmar
  desde un correo.

Y en **Authentication → Providers → Email**, desactiva *Allow new users to sign
up*: sin eso, cualquiera que dé con la URL puede crearse una cuenta.

Para más adelante, si necesitas dar acceso a alguien más, es el mismo camino:
crear el usuario desde el panel. Cada usuario ve solo sus personas y sus dietas
—eso es lo que garantizan las políticas de acceso, y está probado—.

**Solo hay un momento en que la app manda un correo**: cuando pulsas «He olvidado
la contraseña». Para que ese enlace funcione, en **Authentication → URL
Configuration** añade a *Redirect URLs*:

```
http://localhost:3000/auth/callback
https://TU-APP.vercel.app/auth/callback
```

La sesión se mantiene: no tienes que entrar cada vez que abres la app. Si quieres
que dure más antes de pedirte la contraseña otra vez, sube *JWT expiry* en
**Authentication → Sessions**.

### 6. Vercel

Importas el repositorio, pegas las dos variables `NEXT_PUBLIC_*` (la
`service_role` **no**), y eliges región europea también aquí. A partir de ahí,
`git push` despliega.

---

## Lo que hay dentro

```
supabase/
  migraciones/0001_esquema.sql          tablas, restricciones, RLS
  migraciones/0002_guardar_ajuste.sql   guardar un ajuste como versión nueva
  migraciones/0003_linaje.sql           árbol de versiones y totales por comida
  migraciones/0004_medidas.sql          medidas caseras y equivalencias de cocción
  pruebas/                              andamio y pruebas contra PostgreSQL local
  datos/ingredientes.json.gz            catálogo de la fase 1
scripts/cargar-ingredientes.mjs
scripts/cargar-medidas.mjs
lib/
  motor/          el motor de la fase 3, sin tocar
  dominio/        conversión filas ↔ motor, comparador, medidas y sustitución  (76 tests)
  supabase/       clientes de navegador y servidor
app/
  login, cuenta, personas, personas/[id], dietas/[id],
  dietas/[id]/historial, comparar, ingredientes
components/
  EditorDieta.tsx          la pantalla de trabajo
  PanelSustitucion.tsx     cambiar un alimento por otro
  DietaVacia.tsx           una dieta recién creada, antes del primer ingrediente
  BuscadorIngrediente.tsx
  FormularioContrasena.tsx
middleware.ts              refresca la sesión y cierra el paso
```

---

## Decisiones que merecen explicación

### La energía la calcula la base

`ingredientes.kcal_100` es una **columna generada**:

```sql
kcal_100 numeric generated always as
  (4*prot_100 + 4*hc_100 + 9*grasa_100 + 7*alcohol_100) stored
```

No se puede escribir a mano —hay una prueba que lo intenta y comprueba que la
base lo rechaza—, así que no puede desincronizarse de los macros. Es el
principio del concepto («la energía se calcula, nunca se almacena») aplicado
donde de verdad se sostiene solo.

### El control de acceso se probó, no se supuso

Una política que «parece correcta» no vale. Las pruebas montan dos usuarios con
sus datos y comprueban que ninguno alcanza los del otro: ni leyendo, ni por la
vista de totales, ni colando una comida en la dieta ajena, ni creando algo a
nombre de otro, ni regalando una dieta propia cambiándole el dueño.

Y hay un **control negativo**: si se afloja una política a propósito, las pruebas
fallan. Una batería que pasa siempre no demuestra nada.

Un detalle que se escapa fácil: las vistas de PostgreSQL se ejecutan por defecto
con los permisos de quien las creó, así que `v_dietas_totales` lleva
`security_invoker = true`. Sin eso sería un agujero por el que se ven los
totales de las dietas de otros.

### Guardar un ajuste es una sola transacción

Crear la dieta hija, copiar sus comidas, copiar los componentes con los gramos
nuevos y anotar el historial son cinco escrituras. Hechas desde el cliente, que
falle la tercera deja una dieta a medias. Están dentro de `guardar_ajuste()`, con
`SECURITY INVOKER` para que el control de acceso siga aplicando —una función
`SECURITY DEFINER` aquí permitiría clonar la dieta de cualquiera—.

Hay una prueba que corta a mitad y comprueba que no queda nada suelto.

### Correo y contraseña, no enlace mágico

La primera versión entraba con un enlace enviado al correo. Sobre el papel es más
seguro —no hay contraseña que robar— pero en la práctica significaba pedir el
correo y esperar un mensaje cada vez, y eso para una herramienta que se abre
varias veces al día es un peaje absurdo.

Ahora es usuario y contraseña, con el registro público cerrado. El mensaje de
error al fallar es genérico a propósito: distinguir «ese correo no existe» de «la
contraseña no es esa» le diría a un desconocido qué cuentas hay dadas de alta.

### Los `numeric` de PostgreSQL llegan como cadenas

Es la trampa más silenciosa de todas. PostgreSQL serializa `numeric` como texto
para no perder precisión, así que `"80" + "10"` da `"8010"` en vez de `90`. Todo
número pasa por `aNumero()`, que además rechaza nulos y basura en vez de dejar
correr un `NaN` que reaparecería tres pantallas más allá. Hay un test que fija
esa avería para que nadie la reintroduzca.

### El orden de los componentes es la clave para guardar

El motor devuelve los resultados en el mismo orden en que recibe la dieta, y ese
orden es lo que permite volver a casar cada gramaje con su fila. Por eso `aDieta`
ordena de forma estable y devuelve los ids en paralelo, y `gramosAGuardar`
**revienta** si las longitudes no coinciden. Guardar gramos cruzados en silencio
sería el peor fallo posible de esta aplicación.

### Las medidas caseras no se guardan en el componente

Nadie pesa un huevo, lo cuenta. Pero la medida es una comodidad de **entrada y
de lectura**, no un dato del componente. Si se guardara «2 unidades», el primer
ajuste la desincronizaría —el motor mueve gramos, no unidades— y acabarías
viendo «2 huevos» junto a 87 g. Los gramos son el dato; la medida se deduce al
mostrar.

Y solo se enseña cuando cuadra: 106 g de huevo son «2 unidades», pero 72 g no
son ni una ni una y media, así que ahí no se dice nada y mandan los gramos.
Decir «1 unidad» cuando son 72 g sería mentir con buena intención.

### Los factores de cocción se deducen, no se inventan

`factor = (100 − agua_crudo) / (100 − agua_cocido)`, que es cuántos gramos de
cocido salen de un gramo crudo suponiendo que solo se pierde o se gana agua. Sale
de la propia BEDCA, no de una tabla copiada.

Esa suposición se rompe al freír (entra aceite) y cuando la pareja mezcla dos
métodos de cocinado. Por eso hay dos filtros: los fritos quedan fuera, y cada
factor tiene que caer dentro de lo plausible **para su tipo de alimento** —una
carne pierde peso, un cereal seco lo gana—.

De 28 parejas encontradas se aceptan 25. Se descartan la patata (factor 0,37: esa
«patata cocida» de BEDCA es en realidad asada), la calabaza (3,03) y la sémola
(6,74). El script dice cuáles descarta y por qué: un factor mal puesto cambiaría
una dieta en silencio, que es lo peor que puede pasar aquí.

Son solo 25 alimentos de 2.157, así que la conversión es un extra. Lo que sí
cubre a todos es **el aviso**: si la dieta dice llevar las cantidades en crudo y
contiene ingredientes marcados como cocidos, se dice, porque ahí los gramos no
significan lo mismo en unas filas que en otras.

### Sustituir es isoenergético, y por eso funciona

Cambiar A por B **en la cantidad que aporta las mismas kilocalorías**. El total
de la dieta no se mueve, así que lo único que cambia es el reparto de macros,
que es justo lo que se está decidiendo. Eso hace legítimo comparar el reparto
antes y después: solo cambia el numerador.

Con esa primitiva se responden las dos preguntas que uno se hace de verdad: «no
tengo merluza, ¿por qué la cambio?» (el sustituto que menos altera) y «el ajuste
dice que no llego al 35% de proteína» (el cambio que más acerca).

### Tres filtros que hacen la diferencia entre útil y absurdo

**La intuición falla.** Falta proteína, así que metes pollo: cambiar 100 g de
arroz por 313 g de pollo triplica la proteína y de paso hunde los hidratos del
46% al 28%, catorce puntos por debajo de lo pedido. Neto: acerca 0,1 puntos. La
quinoa, que parece menos, acerca 2,8. Por eso hay una **mejora mínima**: ofrecer
un cambio que no cambia nada sería engañoso.

**Las cantidades tienen que ser comida.** Igualar 80 g de arroz con lechuga son
1,4 kg. Hay banda relativa y tope absoluto de 500 g.

**Y hay alimentos con un perfil estupendo por 100 g que nadie come así.** La
primera versión, probada contra el catálogo real, proponía **258 g de café
soluble** para subir la proteína. Al cruzar de grupo quedan fuera bebidas,
condimentos y suplementos; dentro del mismo grupo siguen valiendo, porque si
estás cambiando un café, otro café es una respuesta razonable.

Con los tres filtros, lo que propone para subir proteína sin tocar las kcal son
**legumbres** —judía pinta, alubia, lenteja—, que es la respuesta correcta de
manual. Que salga sola, sin habérselo dicho, es buena señal.

### Comparar versiones es un problema de emparejar, no de restar

Al guardar un ajuste se **clona** la dieta, así que la versión nueva tiene los
mismos alimentos con identificadores distintos. Emparejar por id no sirve de
nada: hay que casarlos por comida e ingrediente, y contemplar que entre una
versión y otra se haya añadido o quitado algo, porque nada impide editar una
versión después de crearla.

`compararDietas()` hace eso, incluido el caso de que el mismo alimento aparezca
dos veces en la misma comida —se emparejan en orden de aparición—. Son 10 tests,
uno de ellos comprobando que comparar en el sentido contrario invierte los
signos.

### El linaje se recorre en dos pasos

Las versiones forman un árbol encadenado por `dieta_padre_id`. Desde la versión
3 quieres ver también de dónde viene, no solo lo que cuelga de ella, así que
`linaje_dieta()` primero sube hasta la raíz y luego baja recogiéndolo todo. Con
`SECURITY INVOKER`, para que nadie vea el linaje de otro —probado en los dos
sentidos—.

### Una dieta nueva nace con sus cinco comidas

Crear una dieta y encontrarse una pantalla en blanco es un mal comienzo. Se
crean desayuno, media mañana, comida, merienda y cena.

---

## Probar el esquema en local

Sin tocar Supabase, contra un PostgreSQL cualquiera:

```bash
psql -d appnut -f supabase/pruebas/00_stub_auth.sql        # imita el esquema auth
psql -d appnut -f supabase/migraciones/0001_esquema.sql
psql -d appnut -f supabase/migraciones/0002_guardar_ajuste.sql
psql -d appnut -f supabase/pruebas/01_rls.sql              # aislamiento
psql -d appnut -f supabase/pruebas/02_guardar_ajuste.sql   # versionado
```

`00_stub_auth.sql` imita lo mínimo del esquema `auth` de Supabase (la tabla de
usuarios y `auth.uid()`) para poder ejercitar las políticas de verdad. **No lo
subas a Supabase**: allí ya existe.

---

## Qué falta

- **Pulido**: renombrar y borrar dietas y personas, límites mínimo y máximo por
  componente, reordenar.
