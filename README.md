# VEL Relay Server 0.1

Servidor WebSocket persistente para VEL. Este repositorio conserva el protocolo del cliente web VEL (`src/services/relayClient.ts`) y las funciones compartidas de autorización Firebase/Firestore.

## Requisitos de despliegue en Render

- Tipo: **Web Service**
- Runtime: **Node**
- Root Directory: dejar vacío (la raíz del repositorio contiene `package.json`)
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Health Check Path: `/health`

## Variables de entorno

Configurar en Render, sin subir secretos a GitHub:

- `FIREBASE_PROJECT_ID`: ID real del proyecto Firebase.
- `FIREBASE_SERVICE_ACCOUNT`: JSON de la cuenta de servicio Firebase Admin, en el formato que admite `firebaseAdmin.ts` (JSON o Base64).
- `RELAY_ALLOWED_ORIGINS`: opcional; lista separada por comas de orígenes HTTPS permitidos.

Render proporciona `PORT` automáticamente.

## Desarrollo y pruebas

```bash
npm install
npm run build
npm test
npm start
```

`npm test` ejecuta la batería de integración local con almacén de dispositivos simulado. No prueba credenciales reales de Firebase ni dos teléfonos físicos.

## Importante

El relay exige Firebase Auth técnico, desafío firmado ECDSA P-256 y autorización del dispositivo en Firestore. No acepta la autenticación simplificada del antiguo archivo de demostración. El cliente web correspondiente está en `src/services/relayClient.ts` del proyecto VEL completo y debe conservarse sincronizado con este protocolo.

El contenido de mensajes no se persiste. Los sobres cifrados se enrutan únicamente al par autorizado conectado; si el destinatario no está disponible, se informa el fallo y no se crea una cola de mensajes.
