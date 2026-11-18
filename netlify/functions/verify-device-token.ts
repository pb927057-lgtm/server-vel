import {
  getAdminDb,
  hasFirebaseAdminCredentials,
  TokenVerificationResult,
  verifyUserTokenStrict
} from './shared/firebaseAdmin';
import {
  createFirestoreAdminDeviceStore,
  DeviceTransactionStore,
  getAndRefreshDeviceSessionAtomic
} from './shared/deviceAuthService';

export interface VerifyDeviceTokenDeps {
  verifyToken?: (authHeader?: string) => Promise<TokenVerificationResult>;
  hasDbCredentials?: () => boolean;
  getDeviceStore?: () => DeviceTransactionStore;
  nowProvider?: () => Date;
}

/**
 * Contrato de verificación de token e identidad técnica para la segunda intervención (Relay WebSocket).
 * Valida:
 * 1. Token de Firebase Authentication mediante Admin SDK.
 * 2. Existencia y titularidad técnica en dispositivos/{deviceId}.
 * 3. Estado no revocado y autorización activa si se verifica relación entre pares.
 */
export async function verifyDeviceTokenHandler(event: any, deps: VerifyDeviceTokenDeps = {}) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid: false, error: 'Método no permitido. Utilizar POST.' })
    };
  }

  let body: Record<string, any> = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid: false, error: 'Cuerpo JSON inválido.' })
    };
  }

  const authHeader =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    (body.firebaseIdToken ? `Bearer ${String(body.firebaseIdToken).trim()}` : undefined);

  const verifyTokenFn = deps.verifyToken || verifyUserTokenStrict;
  const tokenCheck = await verifyTokenFn(authHeader);

  if (!tokenCheck.authenticated) {
    return {
      statusCode: tokenCheck.reason === 'pending_config' ? 503 : 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valid: false,
        pendingConfig: tokenCheck.reason === 'pending_config',
        reason: tokenCheck.message
      })
    };
  }

  const checkDbCreds = deps.hasDbCredentials || hasFirebaseAdminCredentials;
  if (!checkDbCreds()) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valid: false,
        pendingConfig: true,
        reason: 'FIREBASE_SERVICE_ACCOUNT pendiente de configuración en Netlify.'
      })
    };
  }

  const deviceId = String(body.deviceId || '').trim();
  const peerDeviceId = body.peerDeviceId ? String(body.peerDeviceId).trim() : undefined;

  const store = deps.getDeviceStore
    ? deps.getDeviceStore()
    : createFirestoreAdminDeviceStore(getAdminDb());
  const now = deps.nowProvider ? deps.nowProvider() : new Date();

  const outcome = await getAndRefreshDeviceSessionAtomic(store, tokenCheck.uid, deviceId, now);
  if (!outcome.ok || !outcome.device) {
    return {
      statusCode: outcome.statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valid: false,
        code: outcome.code,
        reason: outcome.reason
      })
    };
  }

  if (outcome.device.status === 'revoked') {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valid: false,
        code: 'DEVICE_REVOKED',
        authUid: tokenCheck.uid,
        device: outcome.device,
        reason: 'El dispositivo técnico se encuentra revocado.'
      })
    };
  }

  if (peerDeviceId) {
    const auth = outcome.activeAuthorization;
    const isPeerAuthorized = Boolean(
      auth &&
        auth.status === 'active' &&
        ((auth.coreDeviceId === deviceId && auth.terminalDeviceId === peerDeviceId) ||
          (auth.terminalDeviceId === deviceId && auth.coreDeviceId === peerDeviceId))
    );
    if (!isPeerAuthorized) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valid: false,
          code: 'PEER_NOT_AUTHORIZED',
          authUid: tokenCheck.uid,
          device: outcome.device,
          reason: 'No existe una autorización activa entre estos dos dispositivos.'
        })
      };
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      valid: true,
      authUid: tokenCheck.uid,
      device: outcome.device,
      activeLink: outcome.activeLink || null,
      activeAuthorization: outcome.activeAuthorization || null
    })
  };
}

export const handler = async (event: any) => {
  return verifyDeviceTokenHandler(event);
};
