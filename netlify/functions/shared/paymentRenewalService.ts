import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { PagoProcesadoRecord, PricingConfig, SuscriptorAdminRecord } from './types';

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface VerifiedMercadoPagoPayment {
  id: string | number;
  status: string;
  status_detail?: string;
  external_reference?: string | null;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
  currency_id?: string;
  payment_method_id?: string;
  payment_type_id?: string;
  date_approved?: string | null;
  preapproval_id?: string | null;
  metadata?: Record<string, any> | null;
  order?: { id?: string | number } | null;
}

export interface PaymentRenewalOutcome {
  ok: boolean;
  grantedDays: number;
  duplicate?: boolean;
  ignored?: boolean;
  reverted?: boolean;
  reason?: string;
  uid?: string;
  paymentId?: string;
  paymentStatus?: string;
  previousVenceEl?: string | null;
  newVenceEl?: string | null;
  newEstado?: SuscriptorAdminRecord['estado'];
}

export interface AtomicRenewalContext {
  getProcessedPayment: (paymentId: string) => Promise<PagoProcesadoRecord | null>;
  getSubscriber: (uid: string) => Promise<SuscriptorAdminRecord | null>;
  getSubscriberPayments: (uid: string) => Promise<PagoProcesadoRecord[]>;
  saveProcessedPayment: (record: PagoProcesadoRecord) => void;
  updateProcessedPayment: (paymentId: string, patch: Partial<PagoProcesadoRecord>) => void;
  updateSubscriber: (uid: string, patch: Partial<SuscriptorAdminRecord> & Record<string, any>) => void;
  markPreferenceStatus?: (preferenceId: string, status: 'paid' | 'reverted', paymentId: string) => void;
}

export interface PaymentTransactionStore {
  runTransaction: <T>(fn: (ctx: AtomicRenewalContext) => Promise<T>) => Promise<T>;
}

/**
 * Determina si un suscriptor ya contrató previamente y conserva su tarifa histórica original.
 * Un usuario en estado 'pendiente_pago' sin fechaUltimoPago ni venceEl no ha contratado todavía.
 */
export function hasContractedHistoricalPrice(
  subscriber: Partial<SuscriptorAdminRecord> | null | undefined
): boolean {
  if (!subscriber) return false;
  if (typeof subscriber.precioContratado !== 'number' || subscriber.precioContratado <= 0) {
    return false;
  }

  const hasPaidHistory = Boolean(subscriber.fechaUltimoPago) || Boolean(subscriber.venceEl);
  const hasContractedState =
    subscriber.estado === 'activo' ||
    subscriber.estado === 'en_gracia' ||
    subscriber.estado === 'suspendido' ||
    subscriber.estado === 'vencido';

  return hasPaidHistory || hasContractedState;
}

/**
 * Resuelve el precio y moneda efectivos para un usuario:
 * - Suscriptor existente: conserva su precioContratado y moneda originales.
 * - Nuevo usuario: utiliza la tarifa comercial vigente del servidor.
 */
export function resolveEffectiveSubscriberPricing(
  subscriber: Partial<SuscriptorAdminRecord> | null | undefined,
  currentPricing: PricingConfig
): { monto: number; moneda: string; isHistorical: boolean } {
  if (hasContractedHistoricalPrice(subscriber) && subscriber) {
    return {
      monto: Number(subscriber.precioContratado),
      moneda: String(subscriber.moneda || currentPricing.moneda || 'ARS').toUpperCase().trim(),
      isHistorical: true
    };
  }

  return {
    monto: Number(currentPricing.monto),
    moneda: String(currentPricing.moneda || 'ARS').toUpperCase().trim(),
    isHistorical: false
  };
}

/**
 * Calcula la nueva fecha de vencimiento sumando exactamente 30 días:
 * - Si la suscripción todavía está vigente (venceEl > now), suma 30 días a venceEl.
 * - Si ya venció o no tenía vencimiento, suma 30 días desde la fecha actual (now).
 */
export function calculateThirtyDayRenewal(
  currentVenceEl: string | null | undefined,
  now: Date = new Date()
): { newVenceEl: string; baseUsed: 'vigente' | 'fecha_actual' } {
  const nowMs = now.getTime();
  if (currentVenceEl) {
    const parsedMs = Date.parse(currentVenceEl);
    if (!Number.isNaN(parsedMs) && parsedMs > nowMs) {
      return {
        newVenceEl: new Date(parsedMs + THIRTY_DAYS_MS).toISOString(),
        baseUsed: 'vigente'
      };
    }
  }

  return {
    newVenceEl: new Date(nowMs + THIRTY_DAYS_MS).toISOString(),
    baseUsed: 'fecha_actual'
  };
}

/**
 * Recalcula la fecha de vencimiento a partir de todos los pagos válidos (no revertidos)
 * en orden cronológico, preservando íntegramente los días legítimos de renovaciones posteriores
 * si un pago anterior sufre un reembolso o contracargo.
 */
export function recalculateVigenciaFromValidPayments(
  allTrackedPayments: PagoProcesadoRecord[],
  revertedPaymentId: string
): { newVenceEl: string | null; remainingValidPayments: PagoProcesadoRecord[] } {
  const sortedAll = [...allTrackedPayments].sort((a, b) => {
    const tA = Date.parse(a.appliedAt || a.dateApproved || a.processedAt || '');
    const tB = Date.parse(b.appliedAt || b.dateApproved || b.processedAt || '');
    return (Number.isNaN(tA) ? 0 : tA) - (Number.isNaN(tB) ? 0 : tB);
  });

  // La base previa al primer pago registrado en el historial conserva cualquier vigencia previa externa
  const baselineVenceEl = sortedAll.length > 0 ? sortedAll[0].previousVenceEl || null : null;

  const remainingValidPayments = sortedAll.filter(
    (p) => p.paymentId !== revertedPaymentId && !p.reverted && p.status === 'approved'
  );

  let runningVenceEl: string | null = baselineVenceEl;
  for (const validPayment of remainingValidPayments) {
    const eventTimeStr = validPayment.appliedAt || validPayment.dateApproved || validPayment.processedAt;
    const eventDate = new Date(eventTimeStr);
    const { newVenceEl } = calculateThirtyDayRenewal(
      runningVenceEl,
      Number.isNaN(eventDate.getTime()) ? new Date() : eventDate
    );
    runningVenceEl = newVenceEl;
  }

  return {
    newVenceEl: runningVenceEl,
    remainingValidPayments
  };
}

/**
 * Procesa un pago consultado directamente en Mercado Pago de forma atómica e idempotente.
 * - Solo procesa pagos del circuito Checkout Pro (ignora pagos con preapproval_id).
 * - Respeta el precio histórico contratado de suscriptores existentes y usa la tarifa vigente para nuevos.
 * - Contempla reembolsos parciales, totales y contracargos, revirtiendo vigencia y recalculando renovaciones posteriores.
 * - Pagos pendientes, rechazados o insuficientes conceden 0 días.
 * - Nunca extiende dos veces por el mismo paymentId.
 */
export async function processVerifiedPaymentAtomic(
  store: PaymentTransactionStore,
  payment: VerifiedMercadoPagoPayment,
  currentPricing: PricingConfig,
  now: Date = new Date()
): Promise<PaymentRenewalOutcome> {
  const paymentId = String(payment.id || '').trim();
  const paymentStatus = String(payment.status || '').toLowerCase().trim();
  const paymentStatusDetail = String(payment.status_detail || '').toLowerCase().trim();

  if (!paymentId) {
    return {
      ok: false,
      grantedDays: 0,
      reason: 'El pago consultado no contiene identificador válido.'
    };
  }

  // Separación estricta de circuitos: los cobros pertenecientes a un Preapproval histórico
  // no deben procesarse como renovaciones manuales de Checkout Pro.
  if (payment.preapproval_id) {
    return {
      ok: true,
      ignored: true,
      grantedDays: 0,
      paymentId,
      paymentStatus,
      reason: 'Pago asociado a suscripción Preapproval histórica; ignorado por payment-webhook de Checkout Pro.'
    };
  }

  const externalRef = String(payment.external_reference || '').trim();
  if (!externalRef || externalRef.includes('@')) {
    // Si es un evento no aprobado sin external_reference válido, igualmente no acredita nada
    if (paymentStatus !== 'approved') {
      return {
        ok: true,
        grantedDays: 0,
        paymentId,
        paymentStatus,
        reason: `Pago en estado '${paymentStatus}': no se conceden días de servicio.`
      };
    }

    return {
      ok: false,
      grantedDays: 0,
      paymentId,
      paymentStatus,
      reason: 'Referencia externa (external_reference) inválida o ausente.'
    };
  }

  const grossAmount = Number(payment.transaction_amount);
  const refundedAmountRaw = Number(payment.transaction_amount_refunded ?? 0);
  const refundedAmount = Number.isFinite(refundedAmountRaw) && refundedAmountRaw > 0 ? refundedAmountRaw : 0;
  const netAmount = Number.isFinite(grossAmount) ? grossAmount - refundedAmount : NaN;
  const currency = String(payment.currency_id || '').toUpperCase().trim();

  const isExplicitReversalStatus =
    paymentStatus === 'refunded' ||
    paymentStatus === 'charged_back' ||
    paymentStatus === 'cancelled';

  const isPartialRefund =
    paymentStatusDetail === 'partially_refunded' ||
    (refundedAmount > 0 && Number.isFinite(grossAmount) && refundedAmount < grossAmount);

  // Transacción atómica: todas las lecturas antes que cualquier escritura
  return store.runTransaction(async (ctx) => {
    const alreadyProcessed = await ctx.getProcessedPayment(paymentId);
    const subscriber = await ctx.getSubscriber(externalRef);
    const subscriberPayments = await ctx.getSubscriberPayments(externalRef);

    // 1. Manejo de reversiones posteriores (reembolso total, contracargo, cancelación o reembolso parcial)
    if (isExplicitReversalStatus || isPartialRefund) {
      const revertReason = isExplicitReversalStatus ? paymentStatus : 'partially_refunded';

      if (alreadyProcessed) {
        if (alreadyProcessed.reverted || alreadyProcessed.status === 'reverted') {
          return {
            ok: true,
            duplicate: true,
            reverted: true,
            grantedDays: 0,
            uid: externalRef,
            paymentId,
            paymentStatus,
            previousVenceEl: subscriber?.venceEl || null,
            newVenceEl: subscriber?.venceEl || null,
            newEstado: subscriber?.estado,
            reason: `Reversión de pago ${paymentId} ya aplicada previamente. Idempotencia mantenida.`
          };
        }

        const nowIso = now.toISOString();
        const { newVenceEl, remainingValidPayments } = recalculateVigenciaFromValidPayments(
          subscriberPayments,
          paymentId
        );

        const stillActive = Boolean(newVenceEl && Date.parse(newVenceEl) > now.getTime());
        const nextEstado: SuscriptorAdminRecord['estado'] = stillActive ? 'activo' : 'suspendido';
        const latestValidPayment =
          remainingValidPayments.length > 0
            ? remainingValidPayments[remainingValidPayments.length - 1]
            : null;

        ctx.updateProcessedPayment(paymentId, {
          status: 'reverted',
          reverted: true,
          revertReason,
          revertedAt: nowIso,
          transactionAmountRefunded: refundedAmount,
          netAmount: Number.isFinite(netAmount) ? netAmount : 0,
          grantedDays: 0
        });

        if (subscriber) {
          ctx.updateSubscriber(externalRef, {
            estado: nextEstado,
            venceEl: newVenceEl,
            fechaProximoPago: newVenceEl,
            fechaUltimoPago: latestValidPayment ? latestValidPayment.dateApproved : null,
            ultimoPagoId: latestValidPayment ? latestValidPayment.paymentId : null,
            ultimoReembolsoEl: nowIso,
            ultimoMotivoReversion: revertReason,
            ultimaActualizacion: nowIso
          });
        }

        if (ctx.markPreferenceStatus && alreadyProcessed.preferenceId) {
          ctx.markPreferenceStatus(alreadyProcessed.preferenceId, 'reverted', paymentId);
        }

        return {
          ok: true,
          reverted: true,
          grantedDays: 0,
          uid: externalRef,
          paymentId,
          paymentStatus: revertReason,
          previousVenceEl: subscriber?.venceEl || null,
          newVenceEl,
          newEstado: nextEstado,
          reason: stillActive
            ? `Pago ${paymentId} revertido (${revertReason}). Vigencia recalculada conservando ${remainingValidPayments.length} pago(s) válido(s) posterior(es).`
            : `Pago ${paymentId} revertido (${revertReason}). Sin pagos válidos vigentes; acceso comercial suspendido.`
        };
      }

      // Reversión o reembolso parcial recibido antes de cualquier acreditación: no concede días
      return {
        ok: true,
        reverted: false,
        grantedDays: 0,
        uid: externalRef,
        paymentId,
        paymentStatus: revertReason,
        previousVenceEl: subscriber?.venceEl || null,
        newVenceEl: subscriber?.venceEl || null,
        newEstado: subscriber?.estado,
        reason: `Pago en estado '${revertReason}': no se acreditan días de servicio.`
      };
    }

    // 2. Solo pagos estrictamente 'approved' (sin reembolso parcial) acreditan días
    if (paymentStatus !== 'approved') {
      return {
        ok: true,
        grantedDays: 0,
        uid: externalRef,
        paymentId,
        paymentStatus,
        reason: `Pago en estado '${paymentStatus}': no se conceden días de servicio hasta su acreditación ('approved').`
      };
    }

    // 3. Idempotencia estricta para pagos ya acreditados
    if (alreadyProcessed) {
      return {
        ok: true,
        duplicate: true,
        grantedDays: 0,
        uid: externalRef,
        paymentId,
        paymentStatus,
        previousVenceEl: alreadyProcessed.previousVenceEl,
        newVenceEl: alreadyProcessed.newVenceEl,
        newEstado: subscriber?.estado,
        reason: `Pago ${paymentId} ya procesado previamente. Idempotencia aplicada.`
      };
    }

    // 4. Verificar existencia del suscriptor
    if (!subscriber) {
      return {
        ok: false,
        grantedDays: 0,
        uid: externalRef,
        paymentId,
        paymentStatus,
        reason: `Suscriptor ${externalRef} no localizado en Firestore (suscriptores/{uid}).`
      };
    }

    // Si la cuenta pertenecía a Preapproval histórico sin preferencia de Checkout Pro y sin metadata checkout_pro,
    // no procesar pagos ajenos si hubiera indicio claro de otro circuito.
    const isCheckoutProPayment =
      payment.metadata?.circuito === 'checkout_pro' ||
      subscriber.modalidadComercial === 'manual_30d' ||
      Boolean(subscriber.mpPreferenceId) ||
      !subscriber.mpPreapprovalId;

    if (!isCheckoutProPayment) {
      return {
        ok: true,
        ignored: true,
        grantedDays: 0,
        uid: externalRef,
        paymentId,
        paymentStatus,
        reason: 'Pago perteneciente a suscripción Preapproval histórica; no modificado por Checkout Pro.'
      };
    }

    // 5. Resolver tarifa esperada respetando el precio histórico si es suscriptor existente
    const effectivePricing = resolveEffectiveSubscriberPricing(subscriber, currentPricing);

    if (!currency || currency !== effectivePricing.moneda) {
      return {
        ok: false,
        grantedDays: 0,
        paymentId,
        paymentStatus,
        uid: externalRef,
        reason: `Moneda recibida (${currency || 'N/A'}) no coincide con la tarifa esperada (${effectivePricing.moneda}).`
      };
    }

    if (Number.isNaN(netAmount) || netAmount < effectivePricing.monto) {
      return {
        ok: false,
        grantedDays: 0,
        paymentId,
        paymentStatus,
        uid: externalRef,
        reason: `Importe neto acreditado (${netAmount}) inferior al precio aplicable (${effectivePricing.monto} ${effectivePricing.moneda}).`
      };
    }

    // 6. Calcular renovación de 30 días y preservar precio contratado original
    const previousVenceEl = subscriber.venceEl || null;
    const { newVenceEl } = calculateThirtyDayRenewal(previousVenceEl, now);
    const nowIso = now.toISOString();
    const dateApproved = payment.date_approved || nowIso;
    const preferenceId =
      (payment.metadata?.preference_id ? String(payment.metadata.preference_id) : null) ||
      subscriber.mpPreferenceId ||
      null;

    const preservedPrecioContratado = effectivePricing.isHistorical
      ? Number(subscriber.precioContratado)
      : grossAmount;
    const preservedMoneda = effectivePricing.isHistorical
      ? effectivePricing.moneda
      : currency;

    const paymentRecord: PagoProcesadoRecord = {
      paymentId,
      uid: externalRef,
      preferenceId,
      status: 'approved',
      reverted: false,
      revertReason: null,
      revertedAt: null,
      transactionAmountRefunded: refundedAmount,
      netAmount,
      grantedDays: 30,
      paymentMethodId: payment.payment_method_id || null,
      paymentTypeId: payment.payment_type_id || null,
      transactionAmount: grossAmount,
      currencyId: currency,
      dateApproved,
      appliedAt: nowIso,
      previousVenceEl,
      newVenceEl,
      processedAt: nowIso
    };

    ctx.saveProcessedPayment(paymentRecord);
    ctx.updateSubscriber(externalRef, {
      estado: 'activo',
      modalidadComercial: 'manual_30d',
      venceEl: newVenceEl,
      fechaUltimoPago: dateApproved,
      fechaProximoPago: newVenceEl,
      fechaInicioGracia: null,
      precioContratado: preservedPrecioContratado,
      moneda: preservedMoneda,
      ultimoPagoId: paymentId,
      ultimoReembolsoEl: null,
      ultimoMotivoReversion: null,
      ultimaActualizacion: nowIso
    });

    if (ctx.markPreferenceStatus && preferenceId) {
      ctx.markPreferenceStatus(preferenceId, 'paid', paymentId);
    }

    return {
      ok: true,
      duplicate: false,
      grantedDays: 30,
      uid: externalRef,
      paymentId,
      paymentStatus,
      previousVenceEl,
      newVenceEl,
      newEstado: 'activo'
    };
  });
}

/**
 * Implementación real sobre Cloud Firestore Admin SDK usando db.runTransaction.
 */
export function createFirestoreAdminPaymentStore(db: Firestore): PaymentTransactionStore {
  return {
    async runTransaction<T>(fn: (ctx: AtomicRenewalContext) => Promise<T>): Promise<T> {
      return db.runTransaction(async (tx: Transaction) => {
        const ctx: AtomicRenewalContext = {
          async getProcessedPayment(paymentId: string): Promise<PagoProcesadoRecord | null> {
            const ref = db.collection('pagos_procesados').doc(paymentId);
            const snap = await tx.get(ref);
            return snap.exists ? (snap.data() as PagoProcesadoRecord) : null;
          },
          async getSubscriber(uid: string): Promise<SuscriptorAdminRecord | null> {
            const ref = db.collection('suscriptores').doc(uid);
            const snap = await tx.get(ref);
            return snap.exists ? (snap.data() as SuscriptorAdminRecord) : null;
          },
          async getSubscriberPayments(uid: string): Promise<PagoProcesadoRecord[]> {
            const query = db.collection('pagos_procesados').where('uid', '==', uid);
            const snap = await tx.get(query);
            return snap.docs.map((d) => d.data() as PagoProcesadoRecord);
          },
          saveProcessedPayment(record: PagoProcesadoRecord): void {
            const ref = db.collection('pagos_procesados').doc(record.paymentId);
            tx.set(ref, record);
          },
          updateProcessedPayment(paymentId: string, patch: Partial<PagoProcesadoRecord>): void {
            const ref = db.collection('pagos_procesados').doc(paymentId);
            tx.update(ref, patch);
          },
          updateSubscriber(uid: string, patch: Partial<SuscriptorAdminRecord> & Record<string, any>): void {
            const ref = db.collection('suscriptores').doc(uid);
            tx.update(ref, patch);
          },
          markPreferenceStatus(preferenceId: string, status: 'paid' | 'reverted', paymentId: string): void {
            const ref = db.collection('preferencias_pago').doc(preferenceId);
            tx.set(
              ref,
              {
                status,
                paymentId,
                updatedAt: new Date().toISOString()
              },
              { merge: true }
            );
          }
        };

        return fn(ctx);
      });
    }
  };
}
