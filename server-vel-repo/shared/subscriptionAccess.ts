import * as crypto from 'crypto';
import { inspectFirebaseAdminConfig } from './firebaseAdmin';
import { SubscriberStatus, SuscriptorAdminRecord } from './types';

export const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_SUBSCRIPTION_PASS_TTL_MS = 48 * 60 * 60 * 1000;

export interface SubscriberAccessEvaluation {
  active: boolean;
  estado: SubscriberStatus | 'no_registrado';
  venceEl: string | null;
  reason: string;
  shouldPersistEstado?: 'vencido' | 'suspendido';
}

/**
 * Evalúa de forma única y determinista si una suscripción comercial tiene acceso vigente.
 * Compartida por download-package, device-session y el servidor Relay.
 */
export function evaluateSubscriberAccess(
  subData: SuscriptorAdminRecord | null | undefined,
  now: Date = new Date()
): SubscriberAccessEvaluation {
  if (!subData) {
    return {
      active: false,
      estado: 'no_registrado',
      venceEl: null,
      reason: 'No se encontró suscripción activa para esta cuenta. Contrata tu mes en Blogger con Mercado Pago.'
    };
  }

  const nowMs = now.getTime();
  const estado = subData.estado || 'pendiente_pago';

  if (estado === 'activo') {
    const venceMs = subData.venceEl ? Date.parse(subData.venceEl) : NaN;
    if (!Number.isNaN(venceMs) && venceMs > nowMs) {
      return {
        active: true,
        estado: 'activo',
        venceEl: subData.venceEl || null,
        reason: 'Suscripción mensual vigente.'
      };
    }

    const elapsedSinceExpiry = Number.isNaN(venceMs) ? GRACE_PERIOD_MS : nowMs - venceMs;
    const nextEstado: 'vencido' | 'suspendido' =
      elapsedSinceExpiry >= GRACE_PERIOD_MS ? 'suspendido' : 'vencido';

    return {
      active: false,
      estado: nextEstado,
      venceEl: subData.venceEl || null,
      shouldPersistEstado: nextEstado,
      reason:
        'Tu período mensual de 30 días venció. Tus copias locales siguen intactas; renueva en Blogger con Mercado Pago para reactivar el envío.'
    };
  }

  if (estado === 'en_gracia') {
    const graceStartMs = subData.fechaInicioGracia
      ? Date.parse(subData.fechaInicioGracia)
      : subData.venceEl
      ? Date.parse(subData.venceEl)
      : NaN;

    if (!Number.isNaN(graceStartMs) && nowMs - graceStartMs < GRACE_PERIOD_MS) {
      return {
        active: true,
        estado: 'en_gracia',
        venceEl: subData.venceEl || null,
        reason: 'Suscripción dentro del período de gracia de 7 días.'
      };
    }

    return {
      active: false,
      estado: 'suspendido',
      venceEl: subData.venceEl || null,
      shouldPersistEstado: 'suspendido',
      reason:
        'El período de gracia de 7 días ha finalizado. Renueva en Blogger con Mercado Pago para reactivar el envío entre tus teléfonos.'
    };
  }

  return {
    active: false,
    estado,
    venceEl: subData.venceEl || null,
    reason:
      estado === 'pendiente_pago'
        ? 'Tu suscripción está pendiente de pago en Mercado Pago.'
        : 'Tu suscripción mensual no está activa. Renueva 30 días en Blogger con Mercado Pago para reactivar el envío.'
  };
}

/**
 * Resuelve un secreto HMAC estable en servidor sin exigir variables de entorno adicionales.
 */
export function resolveSubscriptionSigningSecret(): string | null {
  const explicit = String(process.env.VEL_ACTIVATION_SECRET || '').trim();
  if (explicit.length >= 16) {
    return crypto.createHash('sha256').update(`vel-pass|${explicit}`).digest('hex');
  }

  const mpSecret = String(process.env.MP_WEBHOOK_SECRET || '').trim();
  if (mpSecret.length >= 12) {
    return crypto.createHash('sha256').update(`vel-pass|${mpSecret}`).digest('hex');
  }

  const fbDiag = inspectFirebaseAdminConfig();
  if (fbDiag.ok && fbDiag.credentials?.privateKey) {
    return crypto
      .createHash('sha256')
      .update(`vel-pass|${fbDiag.credentials.clientEmail}|${fbDiag.credentials.privateKey}`)
      .digest('hex');
  }

  return null;
}

/**
 * Emite un pase de activación firmado (HMAC-SHA256) que vincula la instalación PWA
 * con el UID del suscriptor en Firestore sin exponer correo ni datos personales.
 */
export function createSubscriptionPass(
  uid: string,
  now: Date = new Date(),
  ttlMs: number = DEFAULT_SUBSCRIPTION_PASS_TTL_MS,
  secretOverride?: string
): string | null {
  const cleanUid = String(uid || '').trim();
  if (!cleanUid) return null;

  const secret = secretOverride || resolveSubscriptionSigningSecret();
  if (!secret) return null;

  const payloadObj = {
    u: cleanUid,
    exp: now.getTime() + ttlMs
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sigB64 = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

export function verifySubscriptionPass(
  token: string,
  now: Date = new Date(),
  secretOverride?: string
): { valid: boolean; uid?: string; reason?: string } {
  const raw = String(token || '').trim();
  const dotIdx = raw.indexOf('.');
  if (!raw || dotIdx <= 0) {
    return { valid: false, reason: 'Formato de pase de activación inválido.' };
  }

  const secret = secretOverride || resolveSubscriptionSigningSecret();
  if (!secret) {
    return { valid: false, reason: 'No hay secreto de servidor disponible para validar el pase de suscripción.' };
  }

  const payloadB64 = raw.slice(0, dotIdx);
  const sigB64 = raw.slice(dotIdx + 1);
  if (!payloadB64 || !sigB64) {
    return { valid: false, reason: 'Pase de activación incompleto.' };
  }

  const expectedSigB64 = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const providedBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSigB64);

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: 'Firma de pase de activación inválida.' };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const uid = typeof parsed?.u === 'string' ? parsed.u.trim() : '';
    const exp = Number(parsed?.exp || 0);
    if (!uid || !Number.isFinite(exp)) {
      return { valid: false, reason: 'Contenido del pase de activación inválido.' };
    }
    if (now.getTime() > exp) {
      return { valid: false, reason: 'El pase de activación expiró. Vuelve a abrir VEL desde Blogger.' };
    }
    return { valid: true, uid };
  } catch {
    return { valid: false, reason: 'No se pudo decodificar el pase de activación.' };
  }
}
