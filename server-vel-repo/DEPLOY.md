# VEL 0.1 — Servidor Relay WebSocket (`server-vel`)

Repositorio independiente del servidor Relay WebSocket (`relay-server.ts`) conectado a **Render**.

## Arquitectura del Relay en VEL
- Transporte directo de teléfono a teléfono en memoria RAM (sin guardar fotos, videos, notas ni archivos en la nube o en disco).
- Verifica **Firebase ID Tokens** y consulta las colecciones de Firestore (`dispositivos`, `vinculaciones`, `autorizaciones` y `suscriptores/{uid}`).
- Evalúa vigencia mensual de suscripciones en `suscriptores/{uid}`: bloquea temporalmente con `SUBSCRIPTION_EXPIRED` si la suscripción venció y reactiva automáticamente al renovar sin perder el emparejamiento ni las copias locales.

---

## Configuración en Render (Web Service)
- **Build Command:** `npm install`
- **Start Command:** `npm run relay:start` *(también funciona `npm start`)*
- **Health Check Path:** `/health` *(responde HTTP `200` con JSON `{"status":"UP","firebaseAdminConfigured":...}`)*

---

## Variables de entorno requeridas en Render

| Variable | Obligatoria | Descripción |
|---|---|---|
| `FIREBASE_PROJECT_ID` | Sí | `proyecto-vel` |
| `FIREBASE_SERVICE_ACCOUNT` | Sí | JSON completo (o en Base64) de la cuenta de servicio Firebase Admin SDK *(alternativamente `FIREBASE_CLIENT_EMAIL` y `FIREBASE_PRIVATE_KEY`)* |
| `RELAY_ALLOWED_ORIGINS` | Recomendada | Orígenes HTTPS permitidos separados por coma (ej. `https://legendary-pasca-bf280b.netlify.app,https://proyecto-vel.netlify.app`) |
| `PORT` / `RELAY_PORT` | Automática / Opcional | Render inyecta `PORT` automáticamente |

---

## Comandos locales de verificación
- Instalar dependencias: `npm install`
- Verificar TypeScript: `npm run build`
- Ejecutar pruebas del Relay: `npm test`
- Iniciar servidor Relay: `npm run relay:start`
