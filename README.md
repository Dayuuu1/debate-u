# Debate UNAMAD · Universidad Nacional Amazónica de Madre de Dios

Sistema para moderar los tiempos de un debate: un panel protegido para el moderador y, según el evento, un tótem vertical por candidato o **una sola pantalla** para el público y otra para los candidatos. También tiene una vista general para el proyector o la transmisión. Todo se sincroniza por Internet a través de **Vercel + PostgreSQL en Neon**. Está hecho con HTML, CSS y JavaScript, y una API en Node.js; no requiere frameworks.

![Panel del moderador](docs/capturas/panel.jpg)

## Qué incluye

**Para el moderador**

- De 1 a 8 candidatos: se agregan, quitan y reordenan desde «Configurar debate».
- **Rondas del debate** (por ejemplo Presentación, Réplica y Cierre), editables. Al elegir una ronda, todos los cronómetros toman su duración y los tótems muestran su nombre.
- **Siguiente orador** con un clic o con la tecla `→`: pausa el turno actual e inicia el siguiente.
- **Tiempo excedido**: al pasar de 00:00 el contador sigue en rojo con «+» (`+00:15`). Se puede desactivar para que el turno se detenga en cero.
- Iniciar, pausar, reiniciar y sumar o restar segundos. Solo un candidato habla a la vez.
- **Informe de tiempos**: cuánto habló realmente cada candidato en cada ronda, con exportación a CSV (Excel) e impresión o PDF.
- Atajos de teclado (`1`–`8`, `Espacio`, `→`), aviso sonoro, tema claro u oscuro y modo reposo automático.

**Para las pantallas** (se elige el modo en «Configurar debate»)

- **Un tótem por candidato:** tótems verticales 9:16 con foto o flyer, cargo, color y tema por candidato.
- **Pantalla única:**
  - Una **pantalla del público** (16:9) con el candidato presentado, su foto y su tiempo.
  - Una **pantalla de los candidatos** con un cronómetro gigante que cambia de verde a ámbar y a rojo.
  - El moderador pulsa **Presentar en pantalla** y luego **▶** para iniciar el conteo.
- **Fondo de espera:** cuando nadie está hablando, los tótems muestran solo el escudo de la UNAMAD sobre el fondo institucional, o la imagen que subas, por ejemplo el afiche del evento. La pantalla del público hace lo mismo cuando no hay nadie presentado.
- Cada tótem **recuerda su enlace** 30 días: después de abrirlo una vez, basta con `?pantalla=N`.
- Evitan que la pantalla se apague, ocultan el cursor y funcionan en modo quiosco.
- **Vista general 16:9** con todos los candidatos y el orador actual, para el proyector. Tiene una variante con fondo transparente para OBS.
- Vista previa con el logo de la UNAMAD cuando se comparte un enlace por WhatsApp o redes.

**Técnico**

- Acciones con la hora del servidor y control de versiones, para evitar sobrescrituras entre paneles.
- Enlaces de solo lectura firmados para tótems y proyector.
- Las pruebas automáticas se ejecutan en cada despliegue: si fallan, Vercel no publica.
- Limpieza automática de imágenes que ya no usa ningún candidato.

| Configurar debate | Informe de tiempos |
| --- | --- |
| ![Configurar debate](docs/capturas/configurar.jpg) | ![Informe de tiempos](docs/capturas/informe.jpg) |

| Tótem 9:16 | Tótem en espera | Vista general 16:9 |
| --- | --- | --- |
| ![Tótem](docs/capturas/totem.jpg) | ![Tótem con el fondo de espera](docs/capturas/totem-espera.jpg) | ![Vista general](docs/capturas/vista-general.jpg) |

**Modo pantalla única**

| Pantalla del público | Pantalla de los candidatos |
| --- | --- |
| ![Pantalla del público](docs/capturas/pantalla-publico.jpg) | ![Pantalla de los candidatos](docs/capturas/pantalla-candidatos.jpg) |

![Barra «En pantalla» del panel](docs/capturas/panel-pantalla-unica.jpg)

## 1. Requisitos

- Node.js 24 (`package.json` fija `24.x`; Vercel usa esa versión automáticamente).
- Cuenta de Neon (<https://console.neon.tech>) o Neon desde el Marketplace de Vercel.
- Cuenta de Vercel y un repositorio de GitHub.

## 2. Crear la base de datos

1. Crea un proyecto PostgreSQL en Neon en la región **AWS US East 1 (N. Virginia)**. `vercel.json` ejecuta la API en `iad1` (Washington, D.C.); tener base y API en la misma zona evita demoras.
2. Copia la cadena de conexión (puede ser la de pooling). Será `DATABASE_URL`.

Si conectas Neon desde **Vercel → Storage**, deja la casilla «Create database branch for deployment» desmarcada. Usa el prefijo `DATABASE` para que la variable se llame `DATABASE_URL`.

Si tu base está en otra región, cambia `"regions"` en `vercel.json` por la más cercana: São Paulo (`aws-sa-east-1`) → `gru1`; Ohio (`aws-us-east-2`) → `cle1`; Oregón (`aws-us-west-2`) → `pdx1`; Fráncfort (`aws-eu-central-1`) → `fra1`.

## 3. Configurar en tu PC

```bash
npm install
```

Crea `.env.local` a partir de `.env.example`, genera una clave con `npm run secret` y completa:

```dotenv
DATABASE_URL=postgresql://usuario:clave@tu-host.neon.tech/neondb?sslmode=require
ADMIN_PASSWORD="tu-contraseña-de-al-menos-12-caracteres"
SESSION_SECRET="pega-la-clave-generada-con-npm-run-secret"
```

Prepara la base y, si quieres probar en tu PC, levanta el servidor:

```bash
npm run db:setup
npm run dev
```

`db:setup` aplica en orden todos los archivos de `db/` y crea el debate inicial si no existe. Se puede ejecutar varias veces sin borrar datos. **Vuelve a ejecutarlo cuando actualices el proyecto**, para aplicar las migraciones nuevas.

## 4. Subir a Vercel

1. En Vercel, elige **Add New → Project**, importa el repositorio y deja **Other** como framework. `vercel.json` ya declara el build y la carpeta `public`.
2. En **Environment Variables**, añade `ADMIN_PASSWORD` y `SESSION_SECRET` (los mismos de `.env.local`). Si no conectaste Neon desde Storage, añade también `DATABASE_URL`.
3. Despliega. **Cada vez que agregues o cambies una variable, haz Redeploy.** Si falta alguna, el sitio indica exactamente cuál.

Cada `git push` a `main` vuelve a desplegar. El build revisa la sintaxis y los recursos, y ejecuta las pruebas.

Abre los tótems con el **dominio de producción** (por ejemplo `https://tu-proyecto.vercel.app`). Las URL de cada despliegue (`…-git-…` o con letras aleatorias) están protegidas con el inicio de sesión de Vercel.

La vista previa al compartir usa `https://debate-u-nine.vercel.app/assets/og-debate.jpg`. Si cambias de dominio, actualiza esa dirección en `public/index.html`.

## 5. Durante el debate

1. **Configurar debate**: candidatos (el orden define el número de tótem), rondas, aviso amarillo y tiempo excedido.
2. **Personalizar tótem** en cada tarjeta: foto o flyer, cargo, color y tema.
3. **Enlaces de tótems**: copia el enlace completo de cada tótem y ábrelo una vez en su equipo. Ese equipo lo recuerda 30 días.
4. Abre el panel unos minutos antes. Cada tótem está listo cuando su tarjeta indica **● Conectado**.
5. Elige la ronda, inicia el primer turno y usa **Siguiente orador** (`→`).
6. Al terminar, abre **Informe de tiempos** y expórtalo a CSV o PDF.

**Fondo de espera.** En el panel, pulsa **Fondo de espera**:

- Activa o desactiva el fondo de los tótems. Aparece 4 segundos después de que nadie esté hablando y desaparece al iniciar un turno.
- Opcionalmente, sube una imagen vertical (1080 × 1920) para los tótems y otra horizontal (1920 × 1080) para la pantalla del público.
- Sin imágenes se muestra solo el escudo de la UNAMAD, sin texto.

En pantalla única, el botón **▣ Fondo** de la barra «En pantalla» pausa el turno y muestra el fondo en la pantalla del público.

![Diálogo Fondo de espera](docs/capturas/fondo-espera.jpg)

**Modo pantalla única (sin tótems).** Úsalo cuando habrá una pantalla para el público y otra para los candidatos.

1. En **Configurar debate**, elige **Pantalla única** y guarda.
2. En **Enlaces de pantallas**, abre la *Pantalla del público* en el equipo del proyector o la TV del público. Abre la *Pantalla de los candidatos* en el monitor que miran los oradores.
3. En la barra **En pantalla** del panel, pulsa el nombre del candidato (o «Presentar en pantalla» en su tarjeta). Ambas pantallas lo muestran con su tiempo completo.
4. Pulsa **▶ Iniciar** para empezar el conteo. **Siguiente** (o `→`) presenta e inicia al siguiente candidato.

Presentar a otro candidato pausa el turno que estaba corriendo. Mientras nadie esté presentado, la pantalla del público muestra el nombre del evento. Al lado de la barra verás si las dos pantallas están conectadas (●).

**Tótem en modo quiosco (sin barras del navegador).** Después de abrir el enlace completo una vez, crea un acceso directo:

```text
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk "https://tu-proyecto.vercel.app/?pantalla=1"
```

Usa el mismo perfil de Chrome con el que abriste el enlace. Para salir del modo quiosco, pulsa `Alt+F4`. Desactiva también la suspensión del equipo.

**Proyector o transmisión.** En «Enlaces de tótems» está la **Vista general (16:9)**. Para OBS, usa la variante con fondo transparente como *Fuente de navegador* a 1920 × 1080.

Los enlaces permiten ver el debate, **no modificarlo**. Para invalidar todos los enlaces y sesiones, cambia `SESSION_SECRET` en Vercel y haz Redeploy.

## 6. Sincronización y límites

- Con el panel del moderador abierto (o abierto en los últimos 10 minutos), las pantallas consultan el servidor cada segundo. Sin panel, lo hacen cada 30 segundos y muestran «esperando el panel del moderador».
- El panel entra en reposo tras 3 horas sin uso y sin turnos corriendo; vuelve al mover el mouse.
- El servidor fija la hora de vencimiento y cada pantalla calcula la cuenta regresiva localmente. Si se corta Internet, continúa con el último tiempo recibido y muestra un aviso.
- El informe registra el tiempo real en uso de la palabra de cada turno, incluido el excedido. Se conserva al cambiar de ronda o de configuración, y se borra con «Reiniciar informe».
- Las imágenes se comprimen en el navegador (máximo 2160 px y 2 MB) y se guardan en PostgreSQL. Las que nadie usa se eliminan después de 6 horas.
- Cierra el panel y las pantallas al terminar el evento: las pestañas abiertas siguen haciendo peticiones a Vercel y Neon.

## 7. Archivos principales

| Ruta | Función |
| --- | --- |
| `public/index.html` | Interfaz, diálogos y metadatos |
| `public/app.js` | Panel, tótems, vista general, rondas e informe |
| `public/cloud.js` | API, sincronización y enlaces recordados |
| `public/totem.js` | Composición del tótem e imágenes |
| `public/timer-core.js` | Cálculo de tiempos, tiempo excedido y tiempo hablado |
| `public/*.css` | Diseño e identidad UNAMAD (`debate.css`: funciones nuevas) |
| `api/debate.js` | Entrada de la función de Vercel |
| `lib/state.mjs` | Reglas del debate, rondas y validaciones |
| `lib/handler.mjs` | Rutas, permisos, imágenes y comandos |
| `lib/repository.mjs` | Consultas SQL y control de versiones |
| `lib/auth.mjs` | Contraseña, cookie y enlaces firmados |
| `lib/schema.mjs`, `db/*.sql` | Esquema y migraciones |
| `tests/` | Pruebas de API, reglas e interfaz |

## 8. Verificaciones

```bash
npm test
npm run build
```

Las pruebas usan PGlite (PostgreSQL local en memoria) y no requieren credenciales. Cubren:

- Permisos, contraseña y enlaces firmados.
- Tiempo excedido, rondas, candidatos variables e informe.
- Conflictos entre paneles, imágenes y migración de datos antiguos.
- Interacción con la interfaz en un DOM simulado.

## Solución rápida de problemas

| Mensaje | Qué revisar |
| --- | --- |
| Falta configurar en el servidor: … | El mensaje nombra la variable. Corrígela en Vercel y haz Redeploy. |
| No se pudo acceder a la base | Revisa `DATABASE_URL` y ejecuta `npm run db:setup`. |
| El tótem dice que no tiene un enlace válido | Abre el enlace completo desde «Enlaces de tótems» en ese equipo. |
| Tótem «sin candidato asignado» | Hay menos candidatos que tótems; agrégalos en «Configurar debate». |
| Tótem «esperando el panel del moderador» | Abre el panel; se sincroniza en menos de 30 segundos. |
| Una acción no se confirmó | Revisa el estado antes de repetir; pudo confirmarse durante un corte de red. |
| No abre una ventana | Permite ventanas emergentes o usa «Enlaces de tótems». |

Referencias: [Vercel Functions](https://vercel.com/docs/functions/runtimes/node-js), [vercel.json](https://vercel.com/docs/project-configuration/vercel-json), [Neon Serverless Driver](https://github.com/neondatabase/serverless).
