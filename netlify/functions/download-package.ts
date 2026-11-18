import {
  verifyUserTokenStrict,
  getAdminDb,
  TokenVerificationResult
} from './shared/firebaseAdmin';
import { SuscriptorAdminRecord } from './shared/types';

export const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export interface DownloadPackageDeps {
  verifyToken?: (authHeader?: string) => Promise<TokenVerificationResult>;
  getSubscriber?: (uid: string) => Promise<SuscriptorAdminRecord | null>;
  updateSubscriberStatus?: (uid: string, patch: Partial<SuscriptorAdminRecord>) => Promise<void>;
  nowProvider?: () => Date;
}

async function defaultGetSubscriber(uid: string): Promise<SuscriptorAdminRecord | null> {
  const db = getAdminDb();
  const snap = await db.collection('suscriptores').doc(uid).get();
  return snap.exists ? (snap.data() as SuscriptorAdminRecord) : null;
}

async function defaultUpdateSubscriberStatus(
  uid: string,
  patch: Partial<SuscriptorAdminRecord>
): Promise<void> {
  const db = getAdminDb();
  await db.collection('suscriptores').doc(uid).update(patch);
}

export async function downloadPackageHandler(event: any, deps: DownloadPackageDeps = {}) {
  // 1. Extraer token de cabecera 'Authorization' o de parámetro 'token'
  let authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader && event.queryStringParameters?.token) {
    authHeader = `Bearer ${event.queryStringParameters.token}`;
  }

  const verifyTokenFn = deps.verifyToken || verifyUserTokenStrict;
  const tokenCheck = await verifyTokenFn(authHeader);

  if (!tokenCheck.authenticated) {
    if (tokenCheck.reason === 'pending_config') {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorized: false,
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
        authorized: false,
        error: 'No autenticado. Debes iniciar sesión con tu cuenta para acceder a la descarga de la aplicación.'
      })
    };
  }

  const uid = tokenCheck.uid;
  const now = deps.nowProvider ? deps.nowProvider() : new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const wantsJson =
    event.queryStringParameters?.format === 'json' ||
    String(event.headers?.accept || event.headers?.Accept || '').includes('application/json');

  try {
    const getSubscriberFn = deps.getSubscriber || defaultGetSubscriber;
    const updateStatusFn = deps.updateSubscriberStatus || defaultUpdateSubscriberStatus;
    const subData = await getSubscriberFn(uid);

    if (!subData) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorized: false,
          estado: 'no_registrado',
          error: 'No se encontró ficha comercial para esta cuenta. Debes completar la contratación primero.'
        })
      };
    }

    const estado = subData.estado || 'pendiente_pago';

    // 2. Validar vigencia real antes de autorizar descarga
    if (estado === 'activo') {
      const venceMs = subData.venceEl ? Date.parse(subData.venceEl) : NaN;

      // No permitir descargas si venceEl ya expiró (o falta en modalidad manual), aunque estado figure 'activo'
      if (Number.isNaN(venceMs) || venceMs <= nowMs) {
        const elapsedSinceExpiry = Number.isNaN(venceMs) ? GRACE_PERIOD_MS : nowMs - venceMs;
        const nextEstado: SuscriptorAdminRecord['estado'] =
          elapsedSinceExpiry >= GRACE_PERIOD_MS ? 'suspendido' : 'vencido';

        try {
          // La suspensión comercial no borra datos personales, VEL CORE ni revoca dispositivos
          await updateStatusFn(uid, {
            estado: nextEstado,
            ultimaActualizacion: nowIso
          });
        } catch (err) {
          console.warn('Advertencia actualizando estado vencido/suspendido en Firestore:', err);
        }

        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authorized: false,
            estado: nextEstado,
            venceEl: subData.venceEl || null,
            error:
              'Descarga bloqueada: tu período de suscripción ya venció. Renueva 30 días en Mercado Pago para restablecer el acceso.'
          })
        };
      }
    } else if (estado === 'en_gracia') {
      // Gracia comercial de 7 días para cuentas con gracia iniciada: al terminar la gracia, suspender
      const graceStartMs = subData.fechaInicioGracia
        ? Date.parse(subData.fechaInicioGracia)
        : subData.venceEl
        ? Date.parse(subData.venceEl)
        : NaN;

      if (Number.isNaN(graceStartMs) || nowMs - graceStartMs >= GRACE_PERIOD_MS) {
        try {
          await updateStatusFn(uid, {
            estado: 'suspendido',
            ultimaActualizacion: nowIso
          });
        } catch (err) {
          console.warn('Advertencia suspendiendo cuenta tras expirar gracia de 7 días:', err);
        }

        return {
          statusCode: 403,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authorized: false,
            estado: 'suspendido',
            venceEl: subData.venceEl || null,
            error:
              'Descarga bloqueada: el período de gracia de 7 días ha finalizado. Tu acceso comercial está suspendido hasta regularizar el pago.'
          })
        };
      }
    } else {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorized: false,
          estado,
          venceEl: subData.venceEl || null,
          error: `Descarga no autorizada: tu suscripción se encuentra en estado '${estado}'. Renueva tu acceso en Mercado Pago.`
        })
      };
    }

    // 3. Descarga autorizada
    if (wantsJson) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({
          authorized: true,
          estado,
          venceEl: subData.venceEl || null,
          downloadUrl: '/vel-netlify-actualizacion.zip'
        })
      };
    }

    return {
      statusCode: 302,
      headers: {
        Location: '/vel-netlify-actualizacion.zip',
        'Cache-Control': 'no-store'
      },
      body: ''
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorized: false,
        error: `Error validando autorización de descarga: ${err?.message || err}`
      })
    };
  }
}

export const handler = async (event: any) => {
  return downloadPackageHandler(event);
};
