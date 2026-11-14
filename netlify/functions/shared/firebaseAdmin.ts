import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';

// Correos electrónicos autorizados para administración comercial de precios
export const AUTHORIZED_ADMIN_EMAILS = [
  'admin@vel.com',
  'soporte@vel.com',
  'pb927057@gmail.com'
];

/**
 * Comprueba si las credenciales de Firebase Admin SDK están configuradas en el entorno.
 */
export function hasFirebaseAdminCredentials(): boolean {
  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountEnv || !serviceAccountEnv.trim()) {
    return false;
  }
  try {
    let parsed: any;
    if (serviceAccountEnv.trim().startsWith('{')) {
      parsed = JSON.parse(serviceAccountEnv);
    } else {
      const decoded = Buffer.from(serviceAccountEnv, 'base64').toString('utf8');
      parsed = JSON.parse(decoded);
    }
    return Boolean(parsed && parsed.client_email && parsed.private_key);
  } catch {
    return false;
  }
}

export function initFirebaseAdmin(): App {
  const apps = getApps();
  if (apps.length > 0 && apps[0]) {
    return apps[0];
  }

  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  const projectId = process.env.FIREBASE_PROJECT_ID || 'proyecto-vel';

  if (serviceAccountEnv && serviceAccountEnv.trim()) {
    try {
      let parsedCreds: any;
      if (serviceAccountEnv.trim().startsWith('{')) {
        parsedCreds = JSON.parse(serviceAccountEnv);
      } else {
        const decoded = Buffer.from(serviceAccountEnv, 'base64').toString('utf8');
        parsedCreds = JSON.parse(decoded);
      }

      return initializeApp({
        credential: cert(parsedCreds),
        projectId: parsedCreds.project_id || projectId
      });
    } catch (err) {
      console.warn('Advertencia: No se pudo parsear FIREBASE_SERVICE_ACCOUNT:', err);
    }
  }

  // Inicialización sin credenciales de cuenta de servicio (únicamente para lectura pública o fallar seguro en verificación)
  return initializeApp({
    projectId
  });
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
    };

/**
 * Verificación estricta de Firebase ID Token mediante Firebase Admin SDK.
 * Nunca acepta tokens sin firma válida ni simula autenticaciones exitosas.
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

  if (!hasFirebaseAdminCredentials()) {
    return {
      authenticated: false,
      reason: 'pending_config',
      message:
        'Configuración pendiente en Netlify: falta configurar FIREBASE_SERVICE_ACCOUNT para verificar tokens en el servidor.'
    };
  }

  try {
    const auth = getAdminAuth();
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
