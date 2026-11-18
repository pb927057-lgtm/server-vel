import {
  getAdminDb,
  hasFirebaseAdminCredentials,
  TokenVerificationResult,
  verifyUserTokenStrict
} from './shared/firebaseAdmin';
import {
  createFirestoreAdminDeviceStore,
  DeviceTransactionStore,
  registerDeviceAtomic,
  validateDeviceRegistrationPayload
} from './shared/deviceAuthService';

export interface RegisterDeviceDeps {
  verifyToken?: (authHeader?: string) => Promise<TokenVerificationResult>;
  hasDbCredentials?: () => boolean;
  getDeviceStore?: () => DeviceTransactionStore;
  nowProvider?: () => Date;
}

export async function registerDeviceHandler(event: any, deps: RegisterDeviceDeps = {}) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Método no permitido. Utilizar POST.' })
    };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const verifyTokenFn = deps.verifyToken || verifyUserTokenStrict;
  const tokenCheck = await verifyTokenFn(authHeader);

  if (!tokenCheck.authenticated) {
    if (tokenCheck.reason === 'pending_config') {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          pendingConfig: true,
          missingVariables: ['FIREBASE_SERVICE_ACCOUNT'],
          error: tokenCheck.message
        })
      };
    }

    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: tokenCheck.message
      })
    };
  }

  const checkDbCreds = deps.hasDbCredentials || hasFirebaseAdminCredentials;
  if (!checkDbCreds()) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        pendingConfig: true,
        missingVariables: ['FIREBASE_SERVICE_ACCOUNT'],
        error: 'FIREBASE_SERVICE_ACCOUNT pendiente de configuración en Netlify.'
      })
    };
  }

  let parsedBody: Record<string, any>;
  try {
    parsedBody = event.body ? JSON.parse(event.body) : {};
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Cuerpo JSON inválido.' })
    };
  }

  const validation = validateDeviceRegistrationPayload(parsedBody);
  if (!validation.valid || !validation.sanitized) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        code: validation.code,
        error: validation.reason
      })
    };
  }

  try {
    const store = deps.getDeviceStore
      ? deps.getDeviceStore()
      : createFirestoreAdminDeviceStore(getAdminDb());
    const now = deps.nowProvider ? deps.nowProvider() : new Date();

    const outcome = await registerDeviceAtomic(
      store,
      tokenCheck.uid,
      validation.sanitized,
      now
    );

    if (!outcome.ok) {
      return {
        statusCode: outcome.statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          code: outcome.code,
          error: outcome.reason
        })
      };
    }

    return {
      statusCode: outcome.statusCode,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        success: true,
        device: outcome.device
      })
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: `Error registrando dispositivo en Firestore: ${err?.message || err}`
      })
    };
  }
}

export const handler = async (event: any) => {
  return registerDeviceHandler(event);
};
