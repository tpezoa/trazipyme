# TraziPyme — Prototipo funcional (App + Dashboard conectados)

Prototipo del MVP descrito en la Ficha técnica del Avance 3: una app móvil de escaneo QR para bodega y un dashboard web de control, **ambos conectados a la misma base de datos** en tiempo real.

## Desplegado en la nube

Este proyecto está pensado para desplegarse en un host gratuito tipo Render.com:

1. Crear una cuenta en [render.com](https://render.com) (puede ser con la misma cuenta de GitHub).
2. Crear un nuevo "Web Service" y conectarlo a este repositorio de GitHub (`trazipyme`).
3. Render detecta automáticamente que es un proyecto Node.js gracias al `package.json`: ejecuta `npm install` y luego `npm start`.
4. El campo `engines.node` en `package.json` (`>=22.0.0`) le indica a Render que use Node 22 o superior, requerido por el módulo `node:sqlite` que usa este proyecto.
5. Una vez desplegado, Render entrega una URL pública (algo como `https://trazipyme.onrender.com`) accesible tanto desde el computador como desde el celular, sin depender de estar en la misma red Wi-Fi.

**Importante sobre los datos:** los hosts gratuitos como Render tienen disco efímero — el archivo SQLite se reinicia cada vez que el servicio se reinicia o se vuelve a desplegar (el código vuelve a precargar los datos de ejemplo automáticamente vía `seedIfEmpty()`). Para este prototipo de curso es un trade-off aceptable; en la arquitectura de producción definida en la Ficha técnica (Supabase + Railway) la base de datos es persistente.

## Cómo ejecutarlo localmente

Requisitos: tener instalado [Node.js](https://nodejs.org) versión 22 o superior.

1. Abre una terminal en esta carpeta (`trazipyme`).
2. Instala dependencias:
   ```
   npm install
   ```
3. Inicia el servidor:
   ```
   npm start
   ```
4. Abre en el navegador:
   - **App móvil (simulada):** http://localhost:3000/app — usa una ventana angosta del navegador o las herramientas de desarrollador en modo "responsive" para ver el formato celular.
   - **Dashboard web:** http://localhost:3000/dashboard

Ambas pantallas leen y escriben en la misma base de datos SQLite, guardada en `~/.trazipyme/trazipyme.db` (fuera de la carpeta del proyecto, para evitar problemas si esta carpeta está sincronizada con Drive/iCloud/Dropbox). Un movimiento registrado desde la app aparece automáticamente en el dashboard (se actualiza solo cada 5 segundos).

## Importante: la carpeta de Drive es solo para respaldo

Google Drive no puede ejecutar código Node.js. Para correr la app localmente, necesitas tener estos archivos en el disco de tu computador (descárgalos de Drive, o usa Google Drive para escritorio que sincroniza esta carpeta a tu Mac) y ejecutar `npm install` y `npm start` desde una Terminal ahí. Abrir el `index.html` haciendo doble clic NO funciona — siempre debe abrirse a través de `http://localhost:3000` (o la URL pública una vez desplegado en la nube).

## Datos de prueba (PIN de acceso a la app)

| Operario | PIN |
|---|---|
| Juan Pérez | 1234 |
| Gerente AyB | 9999 |

Ya viene precargado con 2 bodegas, 7 productos (algunos con stock bajo o por vencer, a propósito, para que las alertas se vean activas) y un historial de movimientos de ejemplo.

## Funcionalidades implementadas

**App móvil** (`/app`)
- Login con PIN.
- Selector de bodega.
- Escaneo QR con la cámara (librería jsQR) + ingreso manual de código como respaldo.
- Confirmación de movimiento (Entrada / Salida / Muestra) con botón grande "Confirmar" (64×64dp) pensado para operarios con guantes.
- Modo especial "Salida por muestra" con campos de responsable y destino.
- "Deshacer último escaneo".
- Generación de código QR para productos nuevos ("Crear QR"), listo para imprimir.
- Historial de movimientos.

**Dashboard web** (`/dashboard`)
- Resumen en tiempo real (SKUs, unidades, valor de inventario, alertas).
- Filtro por bodega.
- Alertas automáticas: vencimiento próximo, stock bajo mínimo, sin movimiento reciente.
- Panel "Ventas en riesgo" (productos bajo el stock mínimo y su valor expuesto).
- Historial de movimientos.
- Reportes exportables en CSV (trazabilidad por lote, mermas/bajas, valorización de inventario) — abren directo en Excel.

## Nota técnica

Esta es una implementación de prototipo (Node.js + Express + SQLite, todo en un solo servidor) que reproduce exactamente la lógica y las pantallas descritas en la Ficha técnica del Avance 3. Para producción, la Ficha técnica define la arquitectura definitiva: React Native + Supabase + Railway. El prototipo sirve para demostrar el flujo funcional end-to-end y la conexión real entre app y dashboard.
