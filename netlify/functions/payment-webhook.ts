import { getAdminDb, hasFirebaseAdminCredentials } from './shared/firebaseAdmin';
import {
  getPayment,
  verifyMpWebhookSignature,
  VerifyWebhookSignatureOptions
} from './shared/mercadopago';
import { getCurrentPricing, PricingUnavailableError } from './shared/pricingService';
import {
  createFirestoreAdminPaymentStore,
  PaymentTransactionStore,
  processVerifiedPaymentAtomic,
  VerifiedMercadoPagoPayment
} from './shared/paymentRenewalService';
import { PricingConfig } from './shared/types';

export interface PaymentWebhookDeps {
  verifySignature?: (
    xSignatureHeader: string | undefined,
    xRequestIdHeader: string | undefined,
    dataId: string | undefined,
    options?: VerifyWebhookSignatureOptions
  ) => { isValid: boolean; pendingConfig?: boolean; reason?: string };
  fetchPayment?: (
    paymentId: string
  ) => Promise<{ success: boolean; pendingConfig?: boolean; data?: any; error?: string }>;
  getPricing?: () => Promise<PricingConfig>;
  hasDbCredentials?: () => boolean;
  getPaymentStore?: () => PaymentTransactionStore;
  nowProvider?: () => Date;
}

export async function paymentWebhookHandler(event: any, deps: PaymentWebhookDeps = {}) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método no permitido. Utilizar POST para webhooks.' })
    };
  }

  let body: any = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const queryParams = event.queryStringParameters || {};
  const dataId = String(
    queryParams['data.id'] || body?.data?.id || queryParams.id || body?.id || ''
  ).trim();
  const notificationType = String(
    body?.type || queryParams?.type || body?.topic || queryParams?.topic || ''
  )
    .toLowerCase()
    .trim();

  // 1. Procesar exclusivamente notificaciones de tipo 'payment'
  if (notificationType !== 'payment') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        received: true,
        ignored: true,
        grantedDays: 0,
        reason: `Notificación de tipo '${notificationType || 'desconocido'}' ignorada (solo se procesan notificaciones 'payment').`
      })
    };
  }

  if (!dataId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Notificación payment sin identificador de pago (data.id).' })
    };
  }

  // 2. Validar firma criptográfica x-signature y vigencia temporal de ts mediante MP_WEBHOOK_SECRET
  const now = deps.nowProvider ? deps.nowProvider() : new Date();
  const xSignature = event.headers?.['x-signature'] || event.headers?.['X-Signature'];
  const xRequestId = event.headers?.['x-request-id'] || event.headers?.['X-Request-Id'];
  const verifySigFn = deps.verifySignature || verifyMpWebhookSignature;
  const sigCheck = verifySigFn(xSignature, xRequestId, dataId, { nowMs: now.getTime() });

  if (!sigCheck.isValid) {
    if (sigCheck.pendingConfig) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pendingConfig: true,
          missingVariables: ['MP_WEBHOOK_SECRET'],
          error: sigCheck.reason
        })
      };
    }

    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: sigCheck.reason || 'Firma de webhook inválida.'
      })
    };
  }

  // 3. Verificar configuración de Firebase Admin antes de operar sobre Firestore
  const checkDbCreds = deps.hasDbCredentials || hasFirebaseAdminCredentials;
  if (!checkDbCreds()) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pendingConfig: true,
        missingVariables: ['FIREBASE_SERVICE_ACCOUNT'],
        error: 'FIREBASE_SERVICE_ACCOUNT pendiente de configuración en Netlify.'
      })
    };
  }

  // 4. Consultar el pago directamente en la API oficial de Mercado Pago (utilizando MP_ACCESS_TOKEN)
  const fetchPaymentFn = deps.fetchPayment || getPayment;
  const mpPayment = await fetchPaymentFn(dataId);

  if (!mpPayment.success || !mpPayment.data) {
    if (mpPayment.pendingConfig) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pendingConfig: true,
          missingVariables: ['MP_ACCESS_TOKEN'],
          error: mpPayment.error || 'MP_ACCESS_TOKEN pendiente de configuración en Netlify.'
        })
      };
    }

    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: mpPayment.error || 'No se pudo verificar el pago en la API de Mercado Pago.'
      })
    };
  }

  try {
    // 5. Obtener tarifa comercial vigente y ejecutar transacción atómica de renovación (30 días + idempotencia)
    const getPricingFn = deps.getPricing || getCurrentPricing;
    const expectedPricing = await getPricingFn();

    const store = deps.getPaymentStore
      ? deps.getPaymentStore()
      : createFirestoreAdminPaymentStore(getAdminDb());

    const outcome = await processVerifiedPaymentAtomic(
      store,
      mpPayment.data as VerifiedMercadoPagoPayment,
      expectedPricing,
      now
    );

    if (!outcome.ok) {
      return {
        statusCode: 422,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          received: true,
          processed: false,
          grantedDays: 0,
          reason: outcome.reason
        })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        received: true,
        processed: !outcome.ignored,
        ignored: Boolean(outcome.ignored),
        reverted: Boolean(outcome.reverted),
        duplicate: Boolean(outcome.duplicate),
        grantedDays: outcome.grantedDays,
        paymentId: outcome.paymentId,
        paymentStatus: outcome.paymentStatus,
        uid: outcome.uid,
        estado: outcome.newEstado,
        venceEl: outcome.newVenceEl,
        reason: outcome.reason
      })
    };
  } catch (err: any) {
    console.error('Error en payment-webhook:', err);

    if (
      err instanceof PricingUnavailableError ||
      err?.name === 'PricingUnavailableError' ||
      err?.code === 'PRICING_UNAVAILABLE'
    ) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          received: true,
          processed: false,
          retryable: true,
          grantedDays: 0,
          error:
            err?.message ||
            'No se pudo determinar la tarifa vigente en Firestore. Notificación diferida para reintento.'
        })
      };
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        received: true,
        processed: false,
        retryable: true,
        grantedDays: 0,
        error: `Error interno procesando notificación de pago: ${err?.message || err}`
      })
    };
  }
}

export const handler = async (event: any) => {
  return paymentWebhookHandler(event);
};
