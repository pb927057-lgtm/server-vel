export async function createSubscriptionHandler(event: any) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método no permitido. Utilizar POST.' })
    };
  }

  return {
    statusCode: 410,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: false,
      deprecated: true,
      officialCircuit: 'checkout_pro',
      officialEndpoint: '/.netlify/functions/create-preference',
      error:
        'El circuito anterior de suscripciones recurrentes (Preapproval) está deshabilitado para nuevas operaciones. Utiliza Checkout Pro mediante create-preference.'
    })
  };
}

export const handler = async (event: any) => {
  return createSubscriptionHandler(event);
};
