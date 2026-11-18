import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

function netlifyFunctionsDevPlugin(): Plugin {
  return {
    name: 'netlify-functions-dev-middleware',
    apply: 'serve', // Solo se ejecuta durante 'vite dev', no en 'vite build'
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const isApiRoute = req.url?.startsWith('/api/');
        const isNetlifyFnRoute = req.url?.startsWith('/.netlify/functions/');
        if (!isApiRoute && !isNetlifyFnRoute) {
          return next();
        }

        const url = new URL(req.url!, `http://${req.headers.host || 'localhost:3000'}`);
        const prefix = isNetlifyFnRoute ? '/.netlify/functions/' : '/api/';
        const endpoint = url.pathname.replace(prefix, '').split('/')[0];

        const allowedEndpoints: Record<string, string> = {
          'get-pricing': './netlify/functions/get-pricing.ts',
          'create-preference': './netlify/functions/create-preference.ts',
          'payment-webhook': './netlify/functions/payment-webhook.ts',
          'create-subscription': './netlify/functions/create-subscription.ts',
          'mercadopago-webhook': './netlify/functions/mercadopago-webhook.ts',
          'cancel-subscription': './netlify/functions/cancel-subscription.ts',
          'admin-pricing': './netlify/functions/admin-pricing.ts',
          'download-package': './netlify/functions/download-package.ts',
          'register-device': './netlify/functions/register-device.ts',
          'device-session': './netlify/functions/device-session.ts',
          'verify-device-token': './netlify/functions/verify-device-token.ts',
          'pairing-confirm': './netlify/functions/pairing-confirm.ts',
          'revoke-device': './netlify/functions/revoke-device.ts',
          'relay-config': './netlify/functions/relay-config.ts'
        };

        const targetFile = allowedEndpoints[endpoint];
        if (!targetFile) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ error: `Función /api/${endpoint} no encontrada.` }));
        }

        try {
          // Lectura del cuerpo de la petición si es POST o PUT
          let bodyStr = '';
          if (req.method === 'POST' || req.method === 'PUT') {
            for await (const chunk of req) {
              bodyStr += chunk;
            }
          }

          const queryParams: Record<string, string> = {};
          url.searchParams.forEach((val, key) => {
            queryParams[key] = val;
          });

          const event = {
            httpMethod: req.method,
            headers: req.headers,
            queryStringParameters: queryParams,
            body: bodyStr || undefined
          };

          const mod = await server.ssrLoadModule(targetFile);
          const result = await mod.handler(event, {});

          res.statusCode = result.statusCode || 200;
          if (result.headers) {
            Object.entries(result.headers).forEach(([k, v]) => {
              res.setHeader(k, v as string);
            });
          }
          return res.end(result.body || '');
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          return res.end(
            JSON.stringify({
              error: `Error ejecutando /api/${endpoint} en desarrollo: ${err?.message || err}`
            })
          );
        }
      });
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), netlifyFunctionsDevPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.')
      }
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {}
    }
  };
});
