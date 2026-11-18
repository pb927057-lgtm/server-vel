import {
  getAdminDb,
  hasFirebaseAdminCredentials,
  TokenVerificationResult,
  verifyUserTokenStrict
} from './shared/firebaseAdmin';
import {
  createFirestoreAdminDeviceStore,
  deactivateDeviceForRoleChangeAtomic,
  DeviceTransactionStore,
  getAndRefreshDeviceSessionAtomic
} from './shared/deviceAuthService';

export interface DeviceSessionDeps {
  verifyToken?: (authHeader?: string) => Promise<TokenVerificationResult>;
  hasDbCredentials?: () => boolean;
  getDeviceStore?: () => DeviceTransactionStore;
  nowProvider?: () => Date;
}

export async function deviceSessionHandler(event: any, deps: DeviceSessionDeps = {}) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Método no permitido. Utilizar GET o POST.' })
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

  const store = deps.getDeviceStore
    ? deps.getDeviceStore()
    : createFirestoreAdminDeviceStore(getAdminDb());
  const now = deps.nowProvider ? deps.nowProvider() : new Date();

  try {
    if (event.httpMethod === 'GET') {
      const deviceId = String(event.queryStringParameters?.deviceId || '').trim();
      const outcome = await getAndRefreshDeviceSessionAtomic(store, tokenCheck.uid, deviceId, now);

      return {
        statusCode: outcome.statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(
          outcome.ok
            ? {
                success: true,
                device: outcome.device,
                activeLink: outcome.activeLink || null,
                activeAuthorization: outcome.activeAuthorization || null
              }
            : {
                success: false,
                code: outcome.code,
                error: outcome.reason
              }
        )
      };
    }

    let body: Record<string, any>;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Cuerpo JSON inválido.' })
      };
    }

    const action = String(body.action || 'status').trim();
    const deviceId = String(body.deviceId || '').trim();

    if (action === 'deactivate_for_role_change') {
      const outcome = await deactivateDeviceForRoleChangeAtomic(store, tokenCheck.uid, deviceId, now);
      return {
        statusCode: outcome.statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(
          outcome.ok
            ? { success: true, device: outcome.device }
            : { success: false, code: outcome.code, error: outcome.reason }
        )
      };
    }

    const outcome = await getAndRefreshDeviceSessionAtomic(store, tokenCheck.uid, deviceId, now);
    return {
      statusCode: outcome.statusCode,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(
        outcome.ok
          ? {
              success: true,
              device: outcome.device,
              activeLink: outcome.activeLink || null,
              activeAuthorization: outcome.activeAuthorization || null
            }
          : {
              success: false,
              code: outcome.code,
              error: outcome.reason
            }
      )
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: `Error en sesión técnica del dispositivo: ${err?.message || err}`
      })
    };
  }
}

export const handler = async (event: any) => {
  return deviceSessionHandler(event);
};
