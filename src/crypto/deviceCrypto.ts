import { DeviceRole, PublicDeviceKeyBundle } from '../contracts/velContracts';

const DEVICE_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEVICE_ID_SUFFIX_LENGTH = 12;

export const DEVICE_ID_REGEX = /^VEL-(CORE|MOV)-[A-Z0-9]{12}$/;

export interface GeneratedDeviceCryptoMaterial {
  deviceId: string;
  role: DeviceRole;
  ecdhKeyPair: CryptoKeyPair;
  signingKeyPair: CryptoKeyPair;
  publicKeySpkiBase64: string;
  signingPublicKeySpkiBase64: string;
  fingerprint: string;
}

function getWebCrypto(): Crypto {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('Web Crypto API (SubtleCrypto) no está disponible en este entorno.');
  }
  return cryptoObj;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Genera un identificador técnico aleatorio sin nombres ni datos personales.
 * Formato: VEL-CORE-XXXXXXXXXXXX o VEL-MOV-XXXXXXXXXXXX
 */
export function generateRandomDeviceId(role: DeviceRole): string {
  const cryptoObj = getWebCrypto();
  const prefix = role === 'CORE' ? 'VEL-CORE' : 'VEL-MOV';
  const randomBytes = new Uint8Array(DEVICE_ID_SUFFIX_LENGTH);
  cryptoObj.getRandomValues(randomBytes);

  let suffix = '';
  for (let i = 0; i < DEVICE_ID_SUFFIX_LENGTH; i++) {
    suffix += DEVICE_ID_ALPHABET[randomBytes[i] % DEVICE_ID_ALPHABET.length];
  }
  return `${prefix}-${suffix}`;
}

export function isValidDeviceIdFormat(deviceId: string, role?: DeviceRole): boolean {
  if (!DEVICE_ID_REGEX.test(deviceId)) {
    return false;
  }
  if (role === 'CORE') return deviceId.startsWith('VEL-CORE-');
  if (role === 'TERMINAL') return deviceId.startsWith('VEL-MOV-');
  return true;
}

/**
 * Calcula la huella SHA-256 legible (pares hexadecimales separados por ':')
 * a partir de una clave pública SPKI.
 */
export async function computePublicKeyFingerprint(spkiBuffer: ArrayBuffer): Promise<string> {
  const cryptoObj = getWebCrypto();
  const digest = await cryptoObj.subtle.digest('SHA-256', spkiBuffer);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

export async function computeFingerprintFromBase64Spki(spkiBase64: string): Promise<string> {
  const bytes = base64ToUint8Array(spkiBase64);
  return computePublicKeyFingerprint(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/**
 * Genera el material criptográfico de la instalación mediante Web Crypto API.
 * Las claves privadas se crean estrictamente con extractable = false para impedir
 * su exportación, serialización o transmisión fuera del dispositivo.
 */
export async function generateDeviceCryptoMaterial(
  role: DeviceRole
): Promise<GeneratedDeviceCryptoMaterial> {
  const cryptoObj = getWebCrypto();

  // 1. Par ECDH P-256 para futuro intercambio E2EE (clave privada NO exportable)
  const ecdhKeyPair = await cryptoObj.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false, // extractable = false: protege la clave privada
    ['deriveKey', 'deriveBits']
  );

  // 2. Par ECDSA P-256 para pruebas de posesión/firma local sin exponer clave privada
  const signingKeyPair = await cryptoObj.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    false, // extractable = false: protege la clave privada
    ['sign', 'verify']
  );

  if (ecdhKeyPair.privateKey.extractable || signingKeyPair.privateKey.extractable) {
    throw new Error('Error de seguridad: la clave privada generada no puede ser exportable.');
  }

  const [ecdhPublicSpki, signingPublicSpki] = await Promise.all([
    cryptoObj.subtle.exportKey('spki', ecdhKeyPair.publicKey),
    cryptoObj.subtle.exportKey('spki', signingKeyPair.publicKey)
  ]);

  const publicKeySpkiBase64 = arrayBufferToBase64(ecdhPublicSpki);
  const signingPublicKeySpkiBase64 = arrayBufferToBase64(signingPublicSpki);
  const fingerprint = await computePublicKeyFingerprint(ecdhPublicSpki);
  const deviceId = generateRandomDeviceId(role);

  return {
    deviceId,
    role,
    ecdhKeyPair,
    signingKeyPair,
    publicKeySpkiBase64,
    signingPublicKeySpkiBase64,
    fingerprint
  };
}

/**
 * Firma un desafío técnico usando la clave privada no exportable ECDSA del dispositivo.
 */
export async function signTechnicalChallenge(
  privateSigningKey: CryptoKey,
  challenge: string
): Promise<string> {
  const cryptoObj = getWebCrypto();
  const encoded = new TextEncoder().encode(challenge);
  const signature = await cryptoObj.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' }
    },
    privateSigningKey,
    encoded
  );
  return arrayBufferToBase64(signature);
}

/**
 * Comprueba que una clave privada sigue protegida como no exportable.
 */
export function isPrivateKeyProtected(privateKey: CryptoKey | null | undefined): boolean {
  return Boolean(privateKey && privateKey.type === 'private' && privateKey.extractable === false);
}

export function extractPublicKeyBundle(material: {
  deviceId: string;
  role: DeviceRole;
  publicKeySpkiBase64: string;
  signingPublicKeySpkiBase64: string;
  fingerprint: string;
}): PublicDeviceKeyBundle {
  return {
    deviceId: material.deviceId,
    role: material.role,
    publicKeySpkiBase64: material.publicKeySpkiBase64,
    signingPublicKeySpkiBase64: material.signingPublicKeySpkiBase64,
    fingerprint: material.fingerprint
  };
}
