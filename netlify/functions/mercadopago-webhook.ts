import { getAdminDb, hasFirebaseAdminCredentials } from './shared/firebaseAdmin';
import {
  verifyMpWebhookSignature,
  getPreapproval,
  getPayment
} from './shared/mercadopago';
import { SuscriptorAdminRecord, SubscriberStatus } from './shared/types';

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 días de tolerancia reglamentaria

export interface LegacyWebhookDeps {
  verifySignature?: typeof verifyMpWebhookSignature;
  getPreapprovalFn?: typeof getPreapproval;
  getPaymentFn?: typeof getPayment;
  hasDbCredentials?: () => boolean;
}

/**
 * Webhook exclusivo para suscripciones HISTÓRICAS Preapproval.
 * NO procesa ni modifica pagos pertenecientes al circuito oficial Checkout Pro (create-preference / payment-webhook).
 */
export async function legacyPreapprovalWebhookHandler(event: any, deps: LegacyWebhookDeps = {}) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Solo se acepta método POST para webhooks.' })
    };
  }

  let body: any = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const queryParams = event.queryStringParameters || {};
  const dataId = String(queryParams['data.id'] || body?.data?.id || queryParams.id || body.id || '').trim();
  const eventType = String(body.type || queryParams.type || body.topic || queryParams.topic || 'unknown').toLowerCase();
  const action = String(body.action || 'event');

  if (!dataId) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ received: true, note: 'Evento sin data.id' })
    };
  }

  const xSignature = event.headers?.['x-signature'] || event.headers?.['X-Signature'];
  const xRequestId = event.headers?.['x-request-id'] || event.headers?.['X-Request-Id'];

  const verifySigFn = deps.verifySignature || verifyMpWebhookSignature;
  const sigCheck = verifySigFn(xSignature, xRequestId, dataId);
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
      body: JSON.stringify({ error: 'Firma de webhook inválida o no autenticada.' })
    };
  }

  const checkDb = deps.hasDbCredentials || hasFirebaseAdminCredentials;
  if (!checkDb()) {
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

  const db = getAdminDb();
  const eventId = `ev_${eventType}_${dataId}_${action}`;
  const eventRef = db.collection('webhook_events').doc(eventId);

  try {
    const existingEvent = await eventRef.get();
    if (existingEvent.exists && existingEvent.data()?.processed === true) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ received: true, duplicate: true })
      };
    }

    let externalRefUid: string | null = null;
    let newStatus: SubscriberStatus | null = null;
    let paymentDateIso: string | null = null;
    let nextPaymentDateIso: string | null = null;
    let preapprovalId: string | null = null;

    if (eventType.includes('preapproval')) {
      const fetchPreapproval = deps.getPreapprovalFn || getPreapproval;
      const mpPreapproval = await fetchPreapproval(dataId);
      if (mpPreapproval.success && mpPreapproval.data) {
        const pData = mpPreapproval.data;
        preapprovalId = pData.id;
        externalRefUid = pData.external_reference || null;

        const mpStatus = String(pData.status || '').toLowerCase();
        if (mpStatus === 'authorized') {
          newStatus = 'activo';
          paymentDateIso = new Date().toISOString();
          nextPaymentDateIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        } else if (mpStatus === 'cancelled') {
          newStatus = 'cancelado';
        } else if (mpStatus === 'paused' || mpStatus === 'pending') {
          newStatus = 'en_gracia';
        }
      }
    } else if (eventType.includes('payment')) {
      // Protección estricta: si el pago ya pertenece a Checkout Pro o no está vinculado a un Preapproval,
      // ignorar en este webhook para evitar modificar vigencias del circuito oficial Checkout Pro.
      const processedDoc = await db.collection('pagos_procesados').doc(dataId).get();
      if (processedDoc.exists) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            received: true,
            ignored: true,
            reason: 'Pago pertenece al circuito oficial Checkout Pro (pagos_procesados).'
          })
        };
      }

      const fetchPayment = deps.getPaymentFn || getPayment;
      const mpPayment = await fetchPayment(dataId);
      if (mpPayment.success && mpPayment.data) {
        const payData = mpPayment.data;
        if (payData.metadata?.circuito === 'checkout_pro' || !payData.preapproval_id) {
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              received: true,
              ignored: true,
              reason: 'Pago sin preapproval_id o marcado como checkout_pro; delegado exclusivamente a payment-webhook.'
            })
          };
        }

        externalRefUid = payData.external_reference || null;
        preapprovalId = String(payData.preapproval_id);
        const payStatus = String(payData.status || '').toLowerCase();

        if (payStatus === 'approved') {
          newStatus = 'activo';
          paymentDateIso = payData.date_approved || new Date().toISOString();
          nextPaymentDateIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        } else if (payStatus === 'rejected' || payStatus === 'refunded' || payStatus === 'charged_back') {
          newStatus = 'en_gracia';
        }
      }
    }

    if (externalRefUid && newStatus) {
      const userDocRef = db.collection('suscriptores').doc(externalRefUid);
      const userSnap = await userDocRef.get();

      if (userSnap.exists) {
        const currentData = userSnap.data() as SuscriptorAdminRecord;

        // No tocar cuentas que operan bajo el circuito oficial Checkout Pro manual
        if (currentData.modalidadComercial === 'manual_30d' || !currentData.mpPreapprovalId) {
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              received: true,
              ignored: true,
              reason: 'Cuenta configurada en modalidad manual Checkout Pro; webhook Preapproval no modifica su vigencia.'
            })
          };
        }

        const now = new Date();
        const updatePayload: Partial<SuscriptorAdminRecord> & Record<string, any> = {};

        if (preapprovalId) {
          updatePayload.mpPreapprovalId = preapprovalId;
        }

        if (newStatus === 'activo') {
          updatePayload.estado = 'activo';
          updatePayload.fechaUltimoPago = paymentDateIso || now.toISOString();
          updatePayload.venceEl = nextPaymentDateIso || currentData.venceEl;
          updatePayload.fechaProximoPago = nextPaymentDateIso || currentData.venceEl;
          updatePayload.fechaInicioGracia = null;
        } else if (newStatus === 'cancelado') {
          updatePayload.estado = 'cancelado';
          updatePayload.canceladoEl = now.toISOString();
        } else if (newStatus === 'en_gracia') {
          if (!currentData.fechaInicioGracia) {
            updatePayload.fechaInicioGracia = now.toISOString();
            updatePayload.estado = 'en_gracia';
          } else {
            const inicioGraciaTime = new Date(currentData.fechaInicioGracia).getTime();
            const elapsed = now.getTime() - inicioGraciaTime;
            updatePayload.estado = elapsed >= GRACE_PERIOD_MS ? 'suspendido' : 'en_gracia';
          }
        }

        updatePayload.ultimaActualizacion = now.toISOString();
        await userDocRef.update(updatePayload);
      }
    }

    await eventRef.set({
      eventId,
      receivedAt: new Date().toISOString(),
      type: eventType,
      action,
      resourceId: dataId,
      externalReference: externalRefUid,
      statusResolved: newStatus,
      processed: true
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ received: true, processed: true, status: newStatus })
    };
  } catch (err: any) {
    console.error('Error procesando webhook histórico Preapproval:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Fallo interno al procesar webhook: ${err?.message || err}` })
    };
  }
}

export const handler = async (event: any) => {
  return legacyPreapprovalWebhookHandler(event);
};
