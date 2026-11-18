import type { Firestore } from 'firebase-admin/firestore';
import {
  verifyUserTokenStrict,
  getAdminDb,
  TokenVerificationResult
} from './shared/firebaseAdmin';
import {
  createPaymentPreference,
  CreatePreferenceParams,
  PreferenceResponse
} from './shared/mercadopago';
import { getCurrentPricing, PricingUnavailableError } from './shared/pricingService';
import {
  buildBloggerCorsHeaders,
  isOriginAllowedForBlogger
} from './shared/corsBlogger';
import { resolveEffectiveSubscriberPricing } from './shared/paymentRenewalService';
import { PreferenciaPagoRecord, PricingConfig, SuscriptorAdminRecord } from './shared/types';

export interface CreatePreferenceDeps {
  verifyToken?: (authHeader?: string) => Promise<TokenVerificationResult>;
  getPricing?: () => Promise<PricingConfig>;
  getSubscriber?: (uid: string) => Promise<SuscriptorAdminRecord | null>;
  createPreference?: (
    params: CreatePreferenceParams
  ) => Promise<{ success: boolean; pendingConfig?: boolean; data?: PreferenceResponse; error?: string }>;
  recordPreferenceIntent?: (
    uid: string,
    email: string,
    preferenceId: string,
    effectivePricing: { monto: number; moneda: string; isHistorical: boolean }
  ) => Promise<void>;
}

async function defaultGetSubscriber(uid: string): Promise<SuscriptorAdminRecord | null> {
  const db = getAdminDb();
  const snap = await db.collection('suscriptores').doc(uid).get();
  return snap.exists ? (snap.data() as SuscriptorAdminRecord) : null;
}

export async function defaultRecordPreferenceIntent(
  uid: string,
  email: string,
  preferenceId: string,
  effectivePricing: { monto: number; moneda: string; isHistorical: boolean },
  dbOverride?: Firestore
): Promise<void> {
  const db = dbOverride || getAdminDb();
  const nowIso = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    const subRef = db.collection('suscriptores').doc(uid);
    const prefRef = db.collection('preferencias_pago').doc(preferenceId);
    const snap = await tx.get(subRef);

    const prefRecord: PreferenciaPagoRecord = {
      preferenceId,
      uid,
      email,
      amount: effectivePricing.monto,
      currencyId: effectivePricing.moneda,
      isHistoricalPrice: effectivePricing.isHistorical,
      modalidadComercial: 'manual_30d',
      status: 'created',
      createdAt: nowIso
    };
    tx.set(prefRef, prefRecord);

    const basePatch: Record<string, any> = {
      uid,
      email,
      modalidadComercial: 'manual_30d',
      mpPreferenceId: preferenceId,
      mpExternalReference: uid,
      ultimaSolicitudPagoEl: nowIso,
      ultimaTarifaConsultada: effectivePricing.monto
    };

    if (!snap.exists) {
      // Nuevo suscriptor: registra ficha inicial pendiente sin conceder días ni fijar precio histórico hasta acreditar pago
      tx.set(subRef, {
        ...basePatch,
        moneda: effectivePricing.moneda,
        estado: 'pendiente_pago',
        plan: 'Suscripción mensual VEL',
        fechaAlta: nowIso,
        venceEl: null
      });
    } else {
      // Preserva estado, vencimiento y precioContratado histórico del suscriptor existente
      tx.set(subRef, basePatch, { merge: true });
    }
  });
}

export async function createPreferenceHandler(event: any, deps: CreatePreferenceDeps = {}) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const host = event.headers?.host || event.headers?.Host || 'proyecto-vel.netlify.app';
  const corsHeaders = buildBloggerCorsHeaders(origin, host);

  // 1. Validación estricta de CORS (dominio oficial de Blogger o mismo origen del portal VEL)
  if (origin && !isOriginAllowedForBlogger(origin, host)) {
    return {
      statusCode: 403,
      headers: {
        'Content-Type': 'application/json',
        Vary: 'Origin'
      },
      body: JSON.stringify({
        success: false,
        error: 'Origen no autorizado por la política CORS de VEL.'
      })
    };
  }

  // 2. Gestión de solicitudes preflight OPTIONS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Método no permitido. Utilizar POST.'
      })
    };
  }

  // 3. Autenticación Firebase verificada en servidor (ignora UID, email, precio o estado del body)
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const verifyTokenFn = deps.verifyToken || verifyUserTokenStrict;
  const tokenCheck = await verifyTokenFn(authHeader);

  if (!tokenCheck.authenticated) {
    if (tokenCheck.reason === 'pending_config') {
      return {
        statusCode: 503,
        headers: corsHeaders,
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
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: tokenCheck.message
      })
    };
  }

  const authenticUid = tokenCheck.uid;
  const authenticEmail = tokenCheck.email || '';

  try {
    // 4. Obtener tarifa vigente del servidor y ficha real del suscriptor para respetar precio histórico
    const getPricingFn = deps.getPricing || getCurrentPricing;
    const getSubscriberFn = deps.getSubscriber || defaultGetSubscriber;
    const [currentPricing, existingSubscriber] = await Promise.all([
      getPricingFn(),
      getSubscriberFn(authenticUid)
    ]);

    const effectivePricing = resolveEffectiveSubscriberPricing(existingSubscriber, currentPricing);

    // 5. Construir URLs de retorno al portal VEL y webhook oficial de notificaciones de pagos
    const protocol = host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
    const netlifyBaseUrl = (process.env.APP_BASE_URL || `${protocol}://${host}`).replace(/\/+$/, '');
    const portalReturnBase = (process.env.VEL_PORTAL_RETURN_URL || netlifyBaseUrl).replace(/\/+$/, '');
    const notificationUrl = `${netlifyBaseUrl}/.netlify/functions/payment-webhook?source_news=webhooks`;

    const createPreferenceFn = deps.createPreference || createPaymentPreference;
    const mpResult = await createPreferenceFn({
      payerEmail: authenticEmail,
      externalReference: authenticUid,
      title: 'Suscripción mensual VEL',
      amount: effectivePricing.monto,
      currencyId: effectivePricing.moneda,
      backUrls: {
        success: `${portalReturnBase}/?pago_retorno=aprobado`,
        pending: `${portalReturnBase}/?pago_retorno=pendiente`,
        failure: `${portalReturnBase}/?pago_retorno=cancelado`
      },
      notificationUrl
    });

    if (!mpResult.success || !mpResult.data) {
      if (mpResult.pendingConfig) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            pendingConfig: true,
            missingVariables: ['MP_ACCESS_TOKEN'],
            error: mpResult.error || 'MP_ACCESS_TOKEN pendiente de configuración en Netlify.'
          })
        };
      }

      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: mpResult.error || 'No se pudo crear la preferencia de pago en Mercado Pago.'
        })
      };
    }

    const preference = mpResult.data;
    if (!preference.id || typeof preference.init_point !== 'string' || !preference.init_point.startsWith('https://')) {
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: 'Mercado Pago no confirmó una URL de inicio de pago (init_point) válida.'
        })
      };
    }

    // 6. Escritura indispensable en Firestore para trazabilidad preferencia -> usuario -> pago.
    // Si falla la persistencia, no se devuelve una preferencia exitosa.
    const recordFn = deps.recordPreferenceIntent || defaultRecordPreferenceIntent;
    await recordFn(authenticUid, authenticEmail, preference.id, effectivePricing);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        preference_id: preference.id,
        init_point: preference.init_point,
        concepto: 'Suscripción mensual VEL',
        monto: effectivePricing.monto,
        moneda: effectivePricing.moneda,
        tarifaHistoricaConservada: effectivePricing.isHistorical
      })
    };
  } catch (err: any) {
    console.error('Error en create-preference:', err);
    if (
      err instanceof PricingUnavailableError ||
      err?.name === 'PricingUnavailableError' ||
      err?.code === 'PRICING_UNAVAILABLE'
    ) {
      return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          retryable: true,
          error: err?.message || 'Tarifa vigente temporalmente no disponible.'
        })
      };
    }

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: `No se pudo completar la creación y registro de la preferencia de pago: ${err?.message || err}`
      })
    };
  }
}

export const handler = async (event: any) => {
  return createPreferenceHandler(event);
};
