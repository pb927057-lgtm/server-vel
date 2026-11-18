import { verifyUserToken, getAdminDb } from './shared/firebaseAdmin';
import { cancelPreapproval } from './shared/mercadopago';
import { SuscriptorAdminRecord } from './shared/types';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método no permitido. Utilizar POST.' })
    };
  }

  // 1. Verificación obligatoria de autenticación
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const verifiedUser = await verifyUserToken(authHeader);

  if (!verifiedUser) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'No autorizado. Se requiere iniciar sesión.' })
    };
  }

  const uid = verifiedUser.uid;
  const db = getAdminDb();
  const userRef = db.collection('suscriptores').doc(uid);

  try {
    const snap = await userRef.get();
    if (!snap.exists) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Ficha de suscriptor no encontrada.' })
      };
    }

    const userData = snap.data() as SuscriptorAdminRecord;
    const preapprovalId = userData.mpPreapprovalId;

    if (!preapprovalId || userData.modalidadComercial === 'manual_30d') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error:
            'Tu cuenta opera con renovación manual por 30 días (Checkout Pro) y no posee una suscripción automática recurrente para cancelar.'
        })
      };
    }

    // 2. Solicitar la cancelación de la suscripción Preapproval histórica a la API oficial
    const cancelResult = await cancelPreapproval(preapprovalId);
    if (!cancelResult.success) {
      console.warn('Advertencia cancelando en Mercado Pago:', cancelResult.error);
    }

    // 3. Registrar la cancelación en Firestore
    const nowIso = new Date().toISOString();
    await userRef.update({
      estado: 'cancelado',
      canceladoEl: nowIso,
      ultimaActualizacion: nowIso
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        mensaje: 'Suscripción comercial cancelada correctamente.',
        aclaracionSoberania:
          'La cancelación comercial no borra los datos guardados en tu teléfono VEL CORE ni desvincula las identidades de tus dispositivos.'
      })
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Error cancelando suscripción: ${err?.message || err}` })
    };
  }
};
