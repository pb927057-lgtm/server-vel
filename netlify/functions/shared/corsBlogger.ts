export const OFFICIAL_BLOGGER_ORIGIN = 'https://proyecto-vel.blogspot.com';

/**
 * Obtiene la lista estricta de orígenes externos autorizados de Blogger.
 * Por defecto permite únicamente https://proyecto-vel.blogspot.com
 * (y orígenes adicionales declarados en BLOGGER_ORIGIN si la variable está configurada).
 * Nunca utiliza wildcard '*'.
 */
export function getAllowedBloggerOrigins(requestHost?: string): string[] {
  const extra = process.env.BLOGGER_ORIGIN
    ? process.env.BLOGGER_ORIGIN.split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean)
    : [];

  const samePortalOrigins: string[] = [];
  if (process.env.APP_BASE_URL) {
    samePortalOrigins.push(process.env.APP_BASE_URL.trim().replace(/\/+$/, ''));
  }
  if (requestHost && requestHost.trim()) {
    const cleanHost = requestHost.trim().replace(/\/+$/, '');
    const protocol = cleanHost.includes('localhost') || cleanHost.startsWith('127.0.0.1') ? 'http' : 'https';
    samePortalOrigins.push(`${protocol}://${cleanHost}`);
  }

  return Array.from(new Set([OFFICIAL_BLOGGER_ORIGIN, ...extra, ...samePortalOrigins]));
}

export function isOriginAllowedForBlogger(origin: string | undefined, requestHost?: string): boolean {
  if (!origin) return false;
  const normalized = origin.trim().replace(/\/+$/, '');
  return getAllowedBloggerOrigins(requestHost).includes(normalized);
}

/**
 * Construye encabezados CORS exclusivamente para el origen de Blogger autorizado
 * o para el mismo origen del portal VEL en Netlify.
 */
export function buildBloggerCorsHeaders(
  origin: string | undefined,
  requestHost?: string
): Record<string, string> {
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Vary: 'Origin'
  };

  if (origin && isOriginAllowedForBlogger(origin, requestHost)) {
    const normalized = origin.trim().replace(/\/+$/, '');
    return {
      ...baseHeaders,
      'Access-Control-Allow-Origin': normalized,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400'
    };
  }

  return baseHeaders;
}
