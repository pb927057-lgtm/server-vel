import { getCurrentPricing, PricingUnavailableError } from './shared/pricingService';

export const handler = async (event: any) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método no permitido. Utilizar GET.' })
    };
  }

  try {
    const pricing = await getCurrentPricing();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60' // Breve caché de 1 minuto
      },
      body: JSON.stringify({
        success: true,
        pricing: {
          monto: pricing.monto,
          moneda: pricing.moneda,
          periodicidad: pricing.periodicidad,
          actualizadoEl: pricing.actualizadoEl
        }
      })
    };
  } catch (err: any) {
    if (err instanceof PricingUnavailableError || err?.code === 'PRICING_UNAVAILABLE') {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: err?.message || 'Tarifa vigente no configurada o temporalmente no disponible.'
        })
      };
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Error obteniendo precio vigente.' })
    };
  }
};
