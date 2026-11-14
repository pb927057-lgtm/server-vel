/**
 * Contratos técnicos oficiales de VEL 0.1
 * Base compartida para:
 * - Intervención 1: Identidad automática, persistencia local y Firebase/Firestore
 * - Intervención 2: Cliente Relay WebSocket, emparejamiento cifrado E2EE y confirmaciones
 * - Intervención 3: Envío y recepción de solicitudes operativas
 */

export type DeviceRole = 'CORE' | 'TERMINAL';

export type DeviceRegistrationStatus =
  | 'pending_local'
  | 'registered'
  | 'paired'
  | 'revoked';

export type LinkStatus = 'pending' | 'active' | 'revoked';

export type AuthorizationStatus = 'active' | 'revoked';

export type DevicePermission =
  | 'RELAY_CONNECT'
  | 'E2EE_SESSION'
  | 'SYNC_STATUS'
  | 'REVOKE_PEER';

export type RelayConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED_UNAUTHENTICATED'
  | 'AUTHENTICATING'
  | 'AUTHENTICATED'
  | 'LINKED'
  | 'RECONNECTING'
  | 'REVOKED'
  | 'ERROR';

export type OperationDeliveryStatus =
  | 'SENDING'
  | 'ROUTED_AWAITING_ACK'
  | 'CONFIRMED'
  | 'FAILED'
  | 'UNKNOWN';

export interface OperationTrackingRecord {
  operationId: string;
  direction: 'OUTGOING' | 'INCOMING';
  recipientId?: string;
  senderId?: string;
  previewLabel: string;
  status: OperationDeliveryStatus;
  statusDetail: string;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  errorReason?: string;
}

export interface RelayServerConfigResponse {
  configured: boolean;
  wssUrl: string | null;
  source?: 'env' | 'vite_env' | 'none';
  message?: string;
}

/**
 * Conjunto público de claves y huella de un dispositivo (apto para backend y Firestore).
 * Nunca contiene claves privadas ni datos personales.
 */
export interface PublicDeviceKeyBundle {
  deviceId: string;
  role: DeviceRole;
  publicKeySpkiBase64: string;
  signingPublicKeySpkiBase64: string;
  fingerprint: string;
}

/**
 * Identidad técnica persistida localmente en IndexedDB de cada instalación PWA.
 * Las claves privadas permanecen como objetos CryptoKey no exportables (extractable: false).
 */
export interface LocalDeviceIdentityRecord {
  id: 'current';
  deviceId: string;
  role: DeviceRole;
  fingerprint: string;
  publicKeySpkiBase64: string;
  signingPublicKeySpkiBase64: string;
  privateEcdhKey: CryptoKey;
  privateSigningKey: CryptoKey;
  firebaseAuthUid: string | null;
  registrationStatus: DeviceRegistrationStatus;
  activeLinkId: string | null;
  pairedPeerDeviceId: string | null;
  lastServerError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Vista segura (sin CryptoKey) de la identidad técnica para UI y diagnósticos.
 */
export interface DeviceIdentitySummary {
  deviceId: string;
  role: DeviceRole;
  fingerprint: string;
  publicKeySpkiBase64: string;
  signingPublicKeySpkiBase64: string;
  firebaseAuthUid: string | null;
  registrationStatus: DeviceRegistrationStatus;
  activeLinkId: string | null;
  pairedPeerDeviceId: string | null;
  lastServerError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Documento almacenado en Firestore: dispositivos/{deviceId}
 * No contiene claves privadas ni información personal (sin email, nombre, fotos ni mensajes).
 */
export interface DeviceRecord {
  deviceId: string;
  role: DeviceRole;
  authUid: string;
  publicKeySpkiBase64: string;
  signingPublicKeySpkiBase64: string;
  fingerprint: string;
  status: Exclude<DeviceRegistrationStatus, 'pending_local'>;
  activeLinkId: string | null;
  pairedPeerDeviceId: string | null;
  createdAt: string;
  lastSeenAt: string;
  updatedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
}

/**
 * Documento almacenado en Firestore: vinculaciones/{linkId}
 * Representa la relación técnica entre un VEL CORE y un VEL MÓVIL.
 */
export interface DeviceLinkRecord {
  linkId: string;
  coreDeviceId: string;
  terminalDeviceId: string;
  coreAuthUid: string;
  terminalAuthUid: string;
  coreFingerprint: string;
  terminalFingerprint: string;
  corePublicKeySpkiBase64?: string;
  terminalPublicKeySpkiBase64?: string;
  status: LinkStatus;
  sasVerified: boolean;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  revokedByDeviceId: string | null;
  revocationReason: string | null;
}

/**
 * Documento almacenado en Firestore: autorizaciones/{authorizationId}
 * Controla los permisos activos y revocaciones entre dispositivos vinculados.
 */
export interface AuthorizationRecord {
  authorizationId: string;
  linkId: string;
  coreDeviceId: string;
  terminalDeviceId: string;
  coreAuthUid: string;
  terminalAuthUid: string;
  status: AuthorizationStatus;
  permissions: DevicePermission[];
  grantedAt: string;
  revokedAt: string | null;
  revokedByDeviceId: string | null;
  lastActivityAt: string;
}

export type RevocationStatus =
  | 'NONE'
  | 'PENDING'
  | 'PERSISTED_PEER_OFFLINE'
  | 'CONFIRMED'
  | 'UNKNOWN';

/**
 * Contrato de sesión de emparejamiento efímero para el Relay WebSocket.
 */
export interface PairingSessionContract {
  code: string;
  linkId?: string;
  initiatorDeviceId: string;
  initiatorRole: DeviceRole;
  initiatorFingerprint: string;
  initiatorPublicKeyBase64: string;
  initiatorSigningPublicKeyBase64?: string;
  peerDeviceId?: string;
  peerRole?: DeviceRole;
  peerFingerprint?: string;
  peerPublicKeyBase64?: string;
  sasCode?: string;
  localConfirmedSas?: boolean;
  peerConfirmedSas?: boolean;
  stage:
    | 'OFFERING'
    | 'CLAIMING'
    | 'SAS_PENDING'
    | 'SAS_AWAITING_PEER'
    | 'CONFIRMED'
    | 'CANCELLED'
    | 'EXPIRED';
  expiresAt: number;
}

/**
 * Carga de autenticación enviada al servidor Relay WebSocket tras recibir AUTH_CHALLENGE.
 */
export interface RelayAuthPayload {
  type: 'AUTH';
  deviceId: string;
  role: DeviceRole;
  fingerprint: string;
  pairedCoreId?: string | null;
  firebaseIdToken: string;
  challenge: string;
  signatureBase64: string;
  timestamp: number;
}

/**
 * Sobre cifrado E2EE intercambiado mediante el Relay ciego.
 */
export interface RelayEncryptedEnvelope {
  type: 'ENCRYPTED_MESSAGE';
  senderId: string;
  recipientId: string;
  sessionId: string;
  operationId: string;
  iv: string;
  ciphertext: string;
  timestamp: number;
}

/**
 * Confirmación de recepción/descifrado emitida por el dispositivo destinatario.
 */
export interface RelayConfirmationEnvelope {
  type: 'CONFIRMATION';
  senderId: string;
  recipientId: string;
  operationId: string;
  status: 'CONFIRMED' | 'REJECTED';
  timestamp: number;
}

/**
 * Contrato mínimo del cliente Relay WebSocket (Intervención 2 y base para Intervención 3).
 */
export interface RelayClientContract {
  getState(): RelayConnectionState;
  connect(wssUrl: string, firebaseIdTokenProvider: () => Promise<string | null>): void;
  disconnect(): void;
  sendEncryptedEnvelope(envelope: RelayEncryptedEnvelope): boolean;
  sendConfirmation(confirmation: RelayConfirmationEnvelope): boolean;
  onStateChange(listener: (state: RelayConnectionState) => void): () => void;
}

/**
 * Contratos de verificación de token e identidad técnica para endpoints Netlify y Relay.
 */
export interface DeviceTokenVerificationRequest {
  firebaseIdToken: string;
  deviceId: string;
  peerDeviceId?: string;
}

export interface DeviceTokenVerificationResult {
  valid: boolean;
  authUid?: string;
  device?: DeviceRecord;
  activeLink?: DeviceLinkRecord | null;
  activeAuthorization?: AuthorizationRecord | null;
  reason?: string;
}
