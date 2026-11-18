import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import { getAdminDb } from './firebaseAdmin';
import { PricingConfig, PricingHistoryEntry } from './types';

const PRICING_DOC_PATH = 'configuracion_comercial/precios';
const PRICING_HISTORY_COLLECTION = 'configuracion_comercial/precios/historial';

export const DEFAULT_PRICING: PricingConfig = {
  monto: 4500,
  moneda: 'ARS',
  periodicidad: 'mensual',
  actualizadoEl: '2026-11-12T00:00:00.000Z',
  actualizadoPor: 'sistema_inicial'
};

export type PricingUnavailableReason = 'firestore_error' | 'not_configured' | 'invalid_config';

export class PricingUnavailableError extends Error {
  public readonly code = 'PRICING_UNAVAILABLE';
  public readonly retryable = true;

  constructor(
    message: string,
    public readonly reason: PricingUnavailableReason = 'firestore_error',
    public readonly causeError?: unknown
  ) {
    super(message);
    this.name = 'PricingUnavailableError';
  }
}

export function isValidCurrencyCode(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency.trim().toUpperCase());
}

/**
 * Obtiene el precio vigente centralizado desde el servidor (Firestore).
 * Nunca sustituye silenciosamente con DEFAULT_PRICING si falla la lectura o falta configuración.
 */
export async function getCurrentPricing(dbOverride?: Firestore): Promise<PricingConfig> {
  const db = dbOverride || getAdminDb();
  let docSnap: DocumentSnapshot;

  try {
    docSnap = await db.doc(PRICING_DOC_PATH).get();
  } catch (err: any) {
    throw new PricingUnavailableError(
      `No se pudo consultar la tarifa vigente en Firestore (${PRICING_DOC_PATH}): ${err?.message || err}`,
      'firestore_error',
      err
    );
  }

  if (!docSnap.exists) {
    throw new PricingUnavailableError(
      `No existe configuración de tarifa vigente en Firestore (${PRICING_DOC_PATH}).`,
      'not_configured'
    );
  }

  const data = docSnap.data() as Partial<PricingConfig> | undefined;
  const monto = Number(data?.monto);
  const moneda = typeof data?.moneda === 'string' ? data.moneda.trim().toUpperCase() : '';

  if (!Number.isFinite(monto) || monto <= 0 || !isValidCurrencyCode(moneda)) {
    throw new PricingUnavailableError(
      `La tarifa vigente registrada en Firestore (${PRICING_DOC_PATH}) es inválida o está incompleta.`,
      'invalid_config'
    );
  }

  return {
    monto,
    moneda,
    periodicidad: 'mensual',
    actualizadoEl: data?.actualizadoEl || new Date().toISOString(),
    actualizadoPor: data?.actualizadoPor || 'administrador',
    motivoCambio: data?.motivoCambio
  };
}

/**
 * Inicializa de forma única y transaccional configuracion_comercial/precios por decisión explícita
 * de un administrador. Nunca sobrescribe una configuración vigente existente ni modifica precios
 * históricos de suscriptores.
 */
export async function initializePricing(
  montoInicial: number,
  monedaInicial: string,
  adminEmail: string,
  motivoCambio?: string,
  dbOverride?: Firestore
): Promise<{ created: boolean; alreadyInitialized: boolean; pricing: PricingConfig }> {
  const monto = Number(montoInicial);
  const moneda = String(monedaInicial || '').toUpperCase().trim();

  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error('El monto inicial debe ser un número finito mayor a 0.');
  }
  if (!isValidCurrencyCode(moneda)) {
    throw new Error('La moneda inicial debe ser un código ISO de 3 letras válido (ej. ARS).');
  }

  const db = dbOverride || getAdminDb();
  const nowIso = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const docRef = db.doc(PRICING_DOC_PATH);
    const snap = await tx.get(docRef);

    if (snap.exists) {
      const existing = snap.data() as Partial<PricingConfig> | undefined;
      const existingMonto = Number(existing?.monto);
      const existingMoneda =
        typeof existing?.moneda === 'string' ? existing.moneda.trim().toUpperCase() : '';

      if (Number.isFinite(existingMonto) && existingMonto > 0 && isValidCurrencyCode(existingMoneda)) {
        return {
          created: false,
          alreadyInitialized: true,
          pricing: {
            monto: existingMonto,
            moneda: existingMoneda,
            periodicidad: 'mensual',
            actualizadoEl: existing?.actualizadoEl || nowIso,
            actualizadoPor: existing?.actualizadoPor || 'administrador',
            motivoCambio: existing?.motivoCambio
          }
        };
      }
    }

    const initialConfig: PricingConfig = {
      monto,
      moneda,
      periodicidad: 'mensual',
      actualizadoEl: nowIso,
      actualizadoPor: adminEmail,
      motivoCambio: motivoCambio || 'Inicialización comercial de tarifa vigente'
    };

    const historyRef = db.collection(PRICING_HISTORY_COLLECTION).doc();
    tx.set(docRef, initialConfig);
    tx.set(historyRef, {
      ...initialConfig,
      timestamp: nowIso
    });

    return {
      created: true,
      alreadyInitialized: false,
      pricing: initialConfig
    };
  });
}

/**
 * Actualiza el precio oficial para nuevas suscripciones y registra la entrada en el historial
 * REGLA COMERCIAL: Los suscriptores existentes conservan su precio de contratación original.
 */
export async function updatePricing(
  nuevoMonto: number,
  nuevaMoneda: string,
  adminEmail: string,
  motivoCambio?: string,
  dbOverride?: Firestore
): Promise<PricingConfig> {
  const monto = Number(nuevoMonto);
  const moneda = String(nuevaMoneda || '').toUpperCase().trim();
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error('El monto mensual debe ser un número finito mayor a 0.');
  }
  if (!isValidCurrencyCode(moneda)) {
    throw new Error('La moneda debe ser un código ISO de 3 letras válido (ej. ARS).');
  }

  const db = dbOverride || getAdminDb();
  const nowIso = new Date().toISOString();

  const newConfig: PricingConfig = {
    monto,
    moneda,
    periodicidad: 'mensual',
    actualizadoEl: nowIso,
    actualizadoPor: adminEmail,
    motivoCambio: motivoCambio || 'Actualización comercial de tarifa'
  };

  // 1. Guardar precio vigente
  await db.doc(PRICING_DOC_PATH).set(newConfig, { merge: true });

  // 2. Asentar en historial inmutable de precios
  await db.collection(PRICING_HISTORY_COLLECTION).add({
    ...newConfig,
    timestamp: nowIso
  });

  return newConfig;
}

/**
 * Obtiene el historial de modificaciones de precios
 */
export async function getPricingHistory(
  limitCount: number = 20,
  dbOverride?: Firestore
): Promise<PricingHistoryEntry[]> {
  const db = dbOverride || getAdminDb();
  try {
    const snap = await db
      .collection(PRICING_HISTORY_COLLECTION)
      .orderBy('actualizadoEl', 'desc')
      .limit(limitCount)
      .get();

    return snap.docs.map((d: any) => ({
      id: d.id,
      ...(d.data() as PricingConfig)
    }));
  } catch (err) {
    console.warn('Error al leer historial de precios:', err);
    return [];
  }
}
