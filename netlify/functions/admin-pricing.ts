import { verifyUserToken, isUserAdmin, getAdminAuth } from './shared/firebaseAdmin';
import {
  getCurrentPricing,
  initializePricing,
  updatePricing,
  getPricingHistory,
  isValidCurrencyCode,
  PricingUnavailableError
} from './shared/pricingService';
import { PricingConfig, PricingHistoryEntry } from './shared/types';

export interface AdminPricingDeps {
  verifyToken?: (authHeader?: string) => Promise<{ uid: string; email?: string } | null>;
  getUserClaims?: (uid: string) => Promise<any>;
  isAdmin?: (email?: string, claims?: any) => boolean;
  getPricing?: () => Promise<PricingConfig>;
  getHistory?: (limitCount?: number) => Promise<PricingHistoryEntry[]>;
  initPricing?: (
    monto: number,
    moneda: string,
    adminEmail: string,
    motivo?: string
  ) => Promise<{ created: boolean; alreadyInitialized: boolean; pricing: PricingConfig }>;
  savePricing?: (
    monto: number,
    moneda: string,
    adminEmail: string,
    motivo?: string
  ) => Promise<PricingConfig>;
}

export async function adminPricingHandler(event: any, deps: AdminPricingDeps = {}) {
  // 1. Verificación obligatoria de autenticación del operador
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const verifyTokenFn = deps.verifyToken || verifyUserToken;
  const verifiedUser = await verifyTokenFn(authHeader);

  if (!verifiedUser) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No autorizado. Se requiere inicio de sesión administrativo.' })
    };
  }

  // 2. Comprobación de privilegios administrativos en el servidor
  let userClaims: any = null;
  try {
    if (deps.getUserClaims) {
      userClaims = await deps.getUserClaims(verifiedUser.uid);
    } else {
      const auth = getAdminAuth();
      const userRecord = await auth.getUser(verifiedUser.uid);
      userClaims = userRecord.customClaims;
    }
  } catch {
    // Si no se pueden obtener claims, se evalúa por email
  }

  const isAdminFn = deps.isAdmin || isUserAdmin;
  const isAdmin = isAdminFn(verifiedUser.email, userClaims);
  if (!isAdmin) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Acceso denegado. Tu cuenta no cuenta con permisos para modificar precios del servicio.'
      })
    };
  }

  // 3. Manejo de métodos
  if (event.httpMethod === 'GET') {
    const getHistoryFn = deps.getHistory || getPricingHistory;
    const getPricingFn = deps.getPricing || getCurrentPricing;
    const history = await getHistoryFn(25);

    try {
      const current = await getPricingFn();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          initialized: true,
          current,
          history
        })
      };
    } catch (err: any) {
      if (
        err instanceof PricingUnavailableError &&
        (err.reason === 'not_configured' || err.reason === 'invalid_config')
      ) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            initialized: false,
            requiresInitialization: true,
            current: null,
            history,
            mensaje:
              'La configuración comercial (configuracion_comercial/precios) aún no ha sido inicializada por un administrador.'
          })
        };
      }

      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: err?.message || 'Error consultando la configuración comercial vigente en Firestore.'
        })
      };
    }
  }

  if (event.httpMethod === 'POST') {
    let body: any = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Cuerpo de solicitud JSON inválido.' })
      };
    }

    const action = String(body.action || 'update').toLowerCase().trim();
    const nuevoMonto = Number(body.monto);
    const nuevaMoneda =
      body.moneda !== undefined && body.moneda !== null
        ? String(body.moneda).toUpperCase().trim()
        : action === 'initialize'
        ? ''
        : 'ARS';
    const motivo = body.motivoCambio
      ? String(body.motivoCambio).trim()
      : action === 'initialize'
      ? 'Inicialización comercial de tarifa vigente'
      : 'Actualización de tarifa comercial';

    if (!Number.isFinite(nuevoMonto) || nuevoMonto <= 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'El monto mensual debe ser un número positivo mayor a 0.' })
      };
    }

    if (!isValidCurrencyCode(nuevaMoneda)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Debes indicar un código de moneda ISO válido de 3 letras (por ejemplo, ARS).'
        })
      };
    }

    try {
      if (action === 'initialize') {
        const initFn = deps.initPricing || initializePricing;
        const initResult = await initFn(
          nuevoMonto,
          nuevaMoneda,
          verifiedUser.email || verifiedUser.uid,
          motivo
        );

        if (initResult.alreadyInitialized) {
          return {
            statusCode: 409,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              alreadyInitialized: true,
              error:
                'La configuración comercial (configuracion_comercial/precios) ya fue inicializada y no se sobrescribe mediante inicialización.',
              pricing: initResult.pricing
            })
          };
        }

        return {
          statusCode: 201,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            initialized: true,
            mensaje: 'Configuración comercial inicializada exitosamente.',
            pricing: initResult.pricing
          })
        };
      }

      const saveFn = deps.savePricing || updatePricing;
      const updated = await saveFn(
        nuevoMonto,
        nuevaMoneda,
        verifiedUser.email || verifiedUser.uid,
        motivo
      );

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          mensaje: 'Precio comercial actualizado exitosamente.',
          reglaComercial:
            'Los nuevos suscriptores contratarán a este nuevo valor. Los suscriptores existentes conservan su precio de contratación original.',
          pricing: updated
        })
      };
    } catch (err: any) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Fallo al guardar nuevo precio: ${err?.message || err}` })
      };
    }
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Método no permitido. Utilizar GET o POST.' })
  };
}

export const handler = async (event: any) => {
  return adminPricingHandler(event);
};
