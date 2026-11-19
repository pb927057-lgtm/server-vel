import * as crypto from 'crypto';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

// Correos electrónicos autorizados para administración comercial de precios
export const AUTHORIZED_ADMIN_EMAILS = [
  'admin@vel.com',
  'soporte@vel.com',
  'pb927057@gmail.com'
];

const PKCS8_BEGIN_MARKER = '-----BEGIN PRIVATE KEY-----';
const PKCS8_END_MARKER = '-----END PRIVATE KEY-----';

export type FirebaseAdminConfigIssueReason =
  | 'missing_env'
  | 'incomplete_env'
  | 'invalid_service_account'
  | 'invalid_private_key'
  | 'init_error';

export class FirebaseAdminConfigError extends Error {
  public readonly code = 'FIREBASE_ADMIN_CONFIG_ERROR';
  public readonly configReason: FirebaseAdminConfigIssueReason;
  public readonly missingVariables: string[];

  constructor(
    message: string,
    configReason: FirebaseAdminConfigIssueReason = 'init_error',
    missingVariables: string[] = []
  ) {
    super(message);
    this.name = 'FirebaseAdminConfigError';
    this.configReason = configReason;
    this.missingVariables = missingVariables;
  }
}

interface ParsedServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface FirebaseAdminConfigDiagnostics {
  ok: boolean;
  reason?: FirebaseAdminConfigIssueReason;
  missingVariables: string[];
  error?: string;
  credentials?: ParsedServiceAccount;
}

function stripMatchingOuterQuotes(value: string): string {
  let out = value.trim();
  while (
    out.length >= 2 &&
    ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

function tryDecodeServiceAccountJson(raw: string): Record<string, any> | null {
  const cleaned = stripMatchingOuterQuotes(String(raw || ''));
  if (!cleaned) return null;

  if (cleaned.startsWith('{')) {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  }

  // Soporte para Base64 estándar o URL-safe de una cuenta de servicio JSON
  const compact = cleaned.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact) || compact.length < 16) {
    return null;
  }

  const normalizedB64 = compact.replace(/-/g, '+').replace(/_/g, '/');
  const paddedB64 =
    normalizedB64.length % 4 === 0
      ? normalizedB64
      : normalizedB64 + '='.repeat(4 - (normalizedB64.length % 4));

  const decoded = Buffer.from(paddedB64, 'base64').toString('utf8').trim();
  if (!decoded.startsWith('{')) {
    return null;
  }

  const parsed = JSON.parse(decoded);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }
  return null;
}

/**
 * Normaliza y valida estrictamente una clave privada PKCS#8.
 * Admite:
 * - PEM multilínea.
 * - Una sola línea con secuencias \n / \\n literales.
 * - Una sola línea con espacios entre cabecera, cuerpo y pie.
 * - JSON de cuenta de servicio o Base64 de un JSON de cuenta de servicio.
 *
 * Rechaza claves sin cabeceras PKCS#8, con texto ajeno, Base64 corrupto o claves truncadas.
 */
export function normalizePemPrivateKey(rawKey: string, depth: number = 0): string {
  if (depth > 1) {
    throw new FirebaseAdminConfigError(
      'Formato inválido de clave privada PKCS#8.',
      'invalid_private_key',
      []
    );
  }

  let key = stripMatchingOuterQuotes(String(rawKey || ''));
  if (!key) {
    throw new FirebaseAdminConfigError(
      'La clave privada de Firebase Admin está vacía.',
      'invalid_private_key',
      []
    );
  }

  // Si se entrega un JSON de cuenta de servicio o Base64 de JSON directamente
  if (key.startsWith('{') || !key.includes('-----BEGIN')) {
    try {
      const parsedJson = tryDecodeServiceAccountJson(key);
      if (parsedJson && typeof parsedJson.private_key === 'string') {
        return normalizePemPrivateKey(parsedJson.private_key, depth + 1);
      }
      if (key.startsWith('{')) {
        throw new FirebaseAdminConfigError(
          'El JSON de cuenta de servicio no contiene un campo private_key válido.',
          'invalid_service_account',
          []
        );
      }
    } catch (err: any) {
      if (err instanceof FirebaseAdminConfigError) throw err;
      throw new FirebaseAdminConfigError(
        'No se pudo interpretar el JSON/Base64 de la cuenta de servicio de Firebase.',
        'invalid_service_account',
        []
      );
    }
  }

  key = key
    .replace(/\\\\r\\\\n/g, '\n')
    .replace(/\\\\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  const firstBegin = key.indexOf(PKCS8_BEGIN_MARKER);
  const lastBegin = key.lastIndexOf(PKCS8_BEGIN_MARKER);
  const firstEnd = key.indexOf(PKCS8_END_MARKER);
  const lastEnd = key.lastIndexOf(PKCS8_END_MARKER);

  if (firstBegin === -1 || firstEnd === -1) {
    throw new FirebaseAdminConfigError(
      'La clave privada no tiene formato PEM PKCS#8 válido (faltan cabeceras BEGIN/END PRIVATE KEY).',
      'invalid_private_key',
      []
    );
  }

  if (firstBegin !== lastBegin || firstEnd !== lastEnd || firstEnd <= firstBegin) {
    throw new FirebaseAdminConfigError(
      'La clave privada PEM contiene marcadores duplicados o desordenados.',
      'invalid_private_key',
      []
    );
  }

  const prefixOutside = key.slice(0, firstBegin).trim();
  const suffixOutside = key.slice(firstEnd + PKCS8_END_MARKER.length).trim();
  if (prefixOutside.length > 0 || suffixOutside.length > 0) {
    throw new FirebaseAdminConfigError(
      'La clave privada PEM contiene datos inesperados fuera de las cabeceras PKCS#8.',
      'invalid_private_key',
      []
    );
  }

  const rawBody = key.slice(firstBegin + PKCS8_BEGIN_MARKER.length, firstEnd);
  const cleanBody = rawBody.replace(/\s+/g, '');

  if (
    !cleanBody ||
    cleanBody.length < 64 ||
    cleanBody.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBody)
  ) {
    throw new FirebaseAdminConfigError(
      'El cuerpo Base64 de la clave privada PEM está incompleto, truncado o contiene caracteres inválidos.',
      'invalid_private_key',
      []
    );
  }

  const wrappedLines = cleanBody.match(/.{1,64}/g);
  if (!wrappedLines || wrappedLines.length === 0) {
    throw new FirebaseAdminConfigError(
      'No se pudo reconstruir el bloque Base64 de la clave privada PEM.',
      'invalid_private_key',
      []
    );
  }

  const canonicalPem = `${PKCS8_BEGIN_MARKER}\n${wrappedLines.join('\n')}\n${PKCS8_END_MARKER}\n`;

  try {
    crypto.createPrivateKey({
      key: canonicalPem,
      format: 'pem',
      type: 'pkcs8'
    });
  } catch {
    throw new FirebaseAdminConfigError(
      'La clave privada PEM PKCS#8 está truncada, corrupta o no es una clave privada criptográfica válida.',
      'invalid_private_key',
      []
    );
  }

  return canonicalPem;
}

export function inspectFirebaseAdminConfig(
  env: Record<string, string | undefined> = process.env
): FirebaseAdminConfigDiagnostics {
  const defaultProjectId = String(env.FIREBASE_PROJECT_ID || 'proyecto-vel').trim() || 'proyecto-vel';
  const serviceAccountEnv = String(env.FIREBASE_SERVICE_ACCOUNT || '').trim();

  if (serviceAccountEnv) {
    let parsed: Record<string, any> | null = null;
    try {
      parsed = tryDecodeServiceAccountJson(serviceAccountEnv);
    } catch {
      return {
        ok: false,
        reason: 'invalid_service_account',
        missingVariables: [],
        error: 'FIREBASE_SERVICE_ACCOUNT contiene JSON/Base64 inválido.'
      };
    }

    if (!parsed) {
      return {
        ok: false,
        reason: 'invalid_service_account',
        missingVariables: [],
        error: 'FIREBASE_SERVICE_ACCOUNT no contiene un objeto JSON o Base64 válido de cuenta de servicio.'
      };
    }

    const clientEmail = String(parsed.client_email || '').trim();
    const rawPrivateKey = String(parsed.private_key || '');
    const projectId = String(parsed.project_id || defaultProjectId).trim() || defaultProjectId;

    if (!clientEmail || !rawPrivateKey) {
      return {
        ok: false,
        reason: 'invalid_service_account',
        missingVariables: [],
        error: 'FIREBASE_SERVICE_ACCOUNT está incompleto: falta client_email o private_key dentro del JSON.'
      };
    }

    try {
      const privateKey = normalizePemPrivateKey(rawPrivateKey);
      return {
        ok: true,
        missingVariables: [],
        credentials: { projectId, clientEmail, privateKey }
      };
    } catch (err: any) {
      return {
        ok: false,
        reason: err?.configReason || 'invalid_private_key',
        missingVariables: [],
        error: `La clave private_key dentro de FIREBASE_SERVICE_ACCOUNT es inválida o está truncada: ${err?.message || 'formato PEM incorrecto.'}`
      };
    }
  }

  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  const rawPrivateKey = String(env.FIREBASE_PRIVATE_KEY || '').trim();

  if (clientEmail || rawPrivateKey) {
    const missing: string[] = [];
    if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
    if (!rawPrivateKey) missing.push('FIREBASE_PRIVATE_KEY');

    if (missing.length > 0) {
      return {
        ok: false,
        reason: 'incomplete_env',
        missingVariables: missing,
        error: `Configuración incompleta de Firebase Admin en Netlify: falta definir ${missing.join(', ')}.`
      };
    }

    try {
      const privateKey = normalizePemPrivateKey(rawPrivateKey);
      return {
        ok: true,
        missingVariables: [],
        credentials: {
          projectId: defaultProjectId,
          clientEmail,
          privateKey
        }
      };
    } catch (err: any) {
      return {
        ok: false,
        reason: err?.configReason || 'invalid_private_key',
        missingVariables: [],
        error: `FIREBASE_PRIVATE_KEY tiene un formato inválido o está truncada: ${err?.message || 'clave PEM PKCS#8 no válida.'}`
      };
    }
  }

  return {
    ok: false,
    reason: 'missing_env',
    missingVariables: ['FIREBASE_SERVICE_ACCOUNT'],
    error:
      'Variables de entorno faltantes en Netlify: falta configurar FIREBASE_SERVICE_ACCOUNT (o FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY).'
  };
}

export function getFirebaseAdminPendingConfigResponse(
  env: Record<string, string | undefined> = process.env
): {
  pendingConfig: true;
  configReason: FirebaseAdminConfigIssueReason;
  missingVariables: string[];
  error: string;
} {
  const diag = inspectFirebaseAdminConfig(env);
  if (!diag.ok) {
    return {
      pendingConfig: true,
      configReason: diag.reason || 'missing_env',
      missingVariables: diag.missingVariables,
      error:
        diag.error ||
        'Configuración de Firebase Admin SDK pendiente o inválida en Netlify.'
    };
  }

  return {
    pendingConfig: true,
    configReason: 'missing_env',
    missingVariables: ['FIREBASE_SERVICE_ACCOUNT'],
    error:
      'Variables de entorno faltantes en Netlify: falta configurar FIREBASE_SERVICE_ACCOUNT (o FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY).'
  };
}

/**
 * Comprueba si existen credenciales válidas de Firebase Admin SDK utilizables en el entorno
 * (ya sea FIREBASE_SERVICE_ACCOUNT o bien FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY).
 */
export function hasFirebaseAdminCredentials(
  env: Record<string, string | undefined> = process.env
): boolean {
  return inspectFirebaseAdminConfig(env).ok;
}

export function initFirebaseAdmin(): App {
  const apps = getApps();
  if (apps.length > 0 && apps[0]) {
    return apps[0];
  }

  const diag = inspectFirebaseAdminConfig();
  if (!diag.ok || !diag.credentials) {
    throw new FirebaseAdminConfigError(
      diag.error || 'Credenciales de Firebase Admin SDK no disponibles.',
      diag.reason || 'missing_env',
      diag.missingVariables
    );
  }

  try {
    return initializeApp({
      credential: cert({
        projectId: diag.credentials.projectId,
        clientEmail: diag.credentials.clientEmail,
        privateKey: diag.credentials.privateKey
      }),
      projectId: diag.credentials.projectId
    });
  } catch (err: any) {
    throw new FirebaseAdminConfigError(
      `No se pudo inicializar Firebase Admin SDK con las credenciales configuradas: ${err?.message || 'error interno al crear credencial.'}`,
      'init_error',
      []
    );
  }
}

export function getAdminDb(): Firestore {
  const app = initFirebaseAdmin();
  return getFirestore(app);
}

export function getAdminAuth(): Auth {
  const app = initFirebaseAdmin();
  return getAuth(app);
}

export type TokenVerificationResult =
  | { authenticated: true; uid: string; email: string }
  | {
      authenticated: false;
      reason: 'missing_token' | 'invalid_token' | 'pending_config';
      message: string;
      configReason?: FirebaseAdminConfigIssueReason;
      missingVariables?: string[];
    };

/**
 * Verificación estricta de Firebase ID Token mediante Firebase Admin SDK.
 * Distingue errores de configuración/credencial del servidor (pending_config -> 503)
 * de tokens realmente inválidos o expirados (invalid_token -> 401).
 */
export async function verifyUserTokenStrict(authHeader?: string): Promise<TokenVerificationResult> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      reason: 'missing_token',
      message: 'No autorizado. Debes iniciar sesión para continuar.'
    };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return {
      authenticated: false,
      reason: 'missing_token',
      message: 'Token de sesión vacío.'
    };
  }

  let auth: Auth;
  try {
    auth = getAdminAuth();
  } catch (err: any) {
    const configReason: FirebaseAdminConfigIssueReason =
      err instanceof FirebaseAdminConfigError ? err.configReason : 'init_error';
    const missingVariables: string[] =
      err instanceof FirebaseAdminConfigError ? err.missingVariables : [];
    const safeMsg =
      err?.message ||
      'Error de configuración de Firebase Admin SDK en Netlify.';

    console.warn('Error de configuración Firebase Admin SDK:', safeMsg);
    return {
      authenticated: false,
      reason: 'pending_config',
      configReason,
      missingVariables,
      message: safeMsg
    };
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    if (!decoded || !decoded.uid) {
      return {
        authenticated: false,
        reason: 'invalid_token',
        message: 'Token de Firebase inválido.'
      };
    }

    return {
      authenticated: true,
      uid: decoded.uid,
      email: decoded.email || ''
    };
  } catch (err: any) {
    console.warn('Rechazo de ID Token de Firebase:', err?.message || err);
    return {
      authenticated: false,
      reason: 'invalid_token',
      message: 'Token de Firebase inválido o expirado.'
    };
  }
}

/**
 * Compatibilidad para funciones existentes: retorna { uid, email } o null si no es válido.
 */
export async function verifyUserToken(authHeader?: string): Promise<{ uid: string; email?: string } | null> {
  const result = await verifyUserTokenStrict(authHeader);
  if (!result.authenticated) {
    return null;
  }
  return {
    uid: result.uid,
    email: result.email
  };
}

/**
 * Valida si un usuario posee privilegios de administración comercial
 */
export function isUserAdmin(email?: string, customClaims?: any): boolean {
  if (customClaims && customClaims.admin === true) {
    return true;
  }
  if (!email) return false;
  const cleanEmail = email.toLowerCase().trim();
  return AUTHORIZED_ADMIN_EMAILS.includes(cleanEmail);
}
