import WebSocket from 'ws';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { VelRelayServer } from './relay-server';
import {
  AuthorizationRecord,
  DeviceLinkRecord,
  DeviceRecord
} from '../netlify/functions/shared/types';
import {
  DeviceTransactionContext,
  DeviceTransactionStore
} from '../netlify/functions/shared/deviceAuthService';
import {
  generateDeviceCryptoMaterial,
  generateRandomDeviceId
} from '../src/crypto/deviceCrypto';
import { signRelayAuthChallenge } from '../src/crypto/e2eeSession';

function aesGcmEncrypt(key: Buffer, plaintext: string, iv: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]);
}

function aesGcmDecrypt(key: Buffer, iv: Buffer, ciphertextWithTag: Buffer): string {
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const data = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}

function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${errorMsg}`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function createMemoryDeviceStore() {
  const devices = new Map<string, DeviceRecord>();
  const links = new Map<string, DeviceLinkRecord>();
  const authorizations = new Map<string, AuthorizationRecord>();

  const store: DeviceTransactionStore = {
    async runTransaction<T>(fn: (ctx: DeviceTransactionContext) => Promise<T>): Promise<T> {
      const ctx: DeviceTransactionContext = {
        async getDevice(id) {
          const d = devices.get(id);
          return d ? { ...d } : null;
        },
        createDevice(rec) {
          devices.set(rec.deviceId, { ...rec });
        },
        updateDevice(id, patch) {
          const cur = devices.get(id);
          if (cur) devices.set(id, { ...cur, ...patch });
        },
        async getLink(id) {
          const l = links.get(id);
          return l ? { ...l } : null;
        },
        createLink(rec) {
          links.set(rec.linkId, { ...rec });
        },
        updateLink(id, patch) {
          const cur = links.get(id);
          if (cur) links.set(id, { ...cur, ...patch });
        },
        async getAuthorizationByLink(id) {
          const a = authorizations.get(id);
          return a ? { ...a } : null;
        },
        createAuthorization(rec) {
          authorizations.set(rec.authorizationId, { ...rec });
        },
        updateAuthorization(id, patch) {
          const cur = authorizations.get(id);
          if (cur) authorizations.set(id, { ...cur, ...patch });
        }
      };
      return fn(ctx);
    }
  };

  return { store, devices, links, authorizations };
}

async function authenticateSocket(
  serverUrl: string,
  device: DeviceRecord,
  signingPrivateKey: CryptoKey,
  token: string,
  pairedCoreId?: string | null
): Promise<WebSocket> {
  const ws = new WebSocket(serverUrl);
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      ws.on('message', async (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'AUTH_CHALLENGE') {
          const ts = Date.now();
          const sig = await signRelayAuthChallenge(signingPrivateKey, msg.challenge, device.deviceId, ts);
          ws.send(
            JSON.stringify({
              type: 'AUTH',
              deviceId: device.deviceId,
              role: device.role,
              fingerprint: device.fingerprint,
              pairedCoreId: pairedCoreId ?? null,
              firebaseIdToken: token,
              challenge: msg.challenge,
              signatureBase64: sig,
              timestamp: ts
            })
          );
        } else if (msg.type === 'AUTH_SUCCESS') {
          resolve();
        } else if (msg.type === 'AUTH_ERROR') {
          reject(new Error(`AUTH_ERROR: ${msg.error}`));
        }
      });
      ws.on('error', reject);
    }),
    3000,
    `Autenticación de ${device.deviceId}`
  );
  return ws;
}

async function runAllRelayTests() {
  console.log('=== PRUEBAS UNITARIAS DEL SERVIDOR RELAY (AUTENTICACIÓN FUERTE + E2EE) ===\n');

  const testDataDir = path.join(process.cwd(), 'server-vel', 'test-data');
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }

  const db = createMemoryDeviceStore();
  const verifyToken = async (authHeader?: string) => {
    if (!authHeader?.startsWith('Bearer tok-')) {
      return { authenticated: false as const, reason: 'invalid_token' as const, message: 'Token inválido' };
    }
    return { authenticated: true as const, uid: authHeader.replace('Bearer tok-', '').trim(), email: '' };
  };

  const server = new VelRelayServer({
    port: 0,
    storageDir: testDataDir,
    deviceStore: db.store,
    verifyToken,
    hasDbCredentials: () => true,
    heartbeatIntervalMs: 60_000
  });
  const port = await server.start();
  const serverUrl = `ws://127.0.0.1:${port}`;
  const sharedSessionKey = crypto.randomBytes(32);

  const coreMat = await generateDeviceCryptoMaterial('CORE');
  const termMat = await generateDeviceCryptoMaterial('TERMINAL');
  const nowIso = new Date().toISOString();

  const coreRec: DeviceRecord = {
    deviceId: coreMat.deviceId,
    role: 'CORE',
    authUid: 'uid-core-1',
    publicKeySpkiBase64: coreMat.publicKeySpkiBase64,
    signingPublicKeySpkiBase64: coreMat.signingPublicKeySpkiBase64,
    fingerprint: coreMat.fingerprint,
    status: 'registered',
    activeLinkId: null,
    pairedPeerDeviceId: null,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    updatedAt: nowIso,
    revokedAt: null,
    revokedReason: null
  };
  const termRec: DeviceRecord = {
    deviceId: termMat.deviceId,
    role: 'TERMINAL',
    authUid: 'uid-term-1',
    publicKeySpkiBase64: termMat.publicKeySpkiBase64,
    signingPublicKeySpkiBase64: termMat.signingPublicKeySpkiBase64,
    fingerprint: termMat.fingerprint,
    status: 'registered',
    activeLinkId: null,
    pairedPeerDeviceId: null,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    updatedAt: nowIso,
    revokedAt: null,
    revokedReason: null
  };
  db.devices.set(coreRec.deviceId, coreRec);
  db.devices.set(termRec.deviceId, termRec);

  let coreWs: WebSocket | null = null;
  let termWs: WebSocket | null = null;

  try {
    console.log('[PRUEBA 1] Autenticación desafío-respuesta de CORE y MÓVIL + emparejamiento SAS...');
    coreWs = await authenticateSocket(serverUrl, coreRec, coreMat.signingKeyPair.privateKey, 'tok-uid-core-1');
    termWs = await authenticateSocket(serverUrl, termRec, termMat.signingKeyPair.privateKey, 'tok-uid-term-1');

    coreWs.send(
      JSON.stringify({
        type: 'PAIRING_OFFER',
        code: 'TEST-9988',
        initiatorDeviceId: coreRec.deviceId,
        initiatorRole: 'CORE',
        initiatorFingerprint: coreRec.fingerprint,
        initiatorPublicKeyBase64: coreRec.publicKeySpkiBase64
      })
    );
    await withTimeout(
      new Promise<void>((resolve) => {
        coreWs!.on('message', (raw) => {
          const d = JSON.parse(raw.toString());
          if (d.type === 'PAIRING_OFFER_REGISTERED') resolve();
        });
      }),
      2000,
      'PAIRING_OFFER_REGISTERED'
    );

    termWs.send(
      JSON.stringify({
        type: 'PAIRING_CLAIM',
        code: 'TEST-9988',
        claimerDeviceId: termRec.deviceId,
        claimerRole: 'TERMINAL',
        claimerFingerprint: termRec.fingerprint,
        claimerPublicKeyBase64: termRec.publicKeySpkiBase64
      })
    );
    const linkId = await withTimeout(
      new Promise<string>((resolve) => {
        termWs!.on('message', (raw) => {
          const d = JSON.parse(raw.toString());
          if (d.type === 'PAIRING_OFFER_FOUND') resolve(d.linkId);
        });
      }),
      2000,
      'PAIRING_OFFER_FOUND'
    );

    coreWs.send(
      JSON.stringify({
        type: 'PAIRING_CONFIRM',
        code: 'TEST-9988',
        linkId,
        terminalDeviceId: termRec.deviceId,
        sasVerified: true
      })
    );
    await withTimeout(
      new Promise<void>((resolve) => {
        coreWs!.on('message', (raw) => {
          const d = JSON.parse(raw.toString());
          if (d.type === 'PAIRING_AWAITING_PEER') resolve();
        });
      }),
      2000,
      'PAIRING_AWAITING_PEER tras confirmación unilateral de CORE'
    );

    if (db.links.has(linkId)) {
      throw new Error('La vinculación no debe persistir en Firestore antes de confirmar también VEL MÓVIL');
    }

    termWs.send(
      JSON.stringify({
        type: 'PAIRING_CONFIRM',
        code: 'TEST-9988',
        linkId,
        terminalDeviceId: termRec.deviceId,
        sasVerified: true
      })
    );

    await withTimeout(
      new Promise<void>((resolve) => {
        coreWs!.on('message', (raw) => {
          const d = JSON.parse(raw.toString());
          if (d.type === 'PAIRING_CONFIRMED') resolve();
        });
      }),
      2000,
      'PAIRING_CONFIRMED'
    );
    console.log(' -> PASÓ: CORE y Terminal autenticados y vinculados vía confirmación SAS mutua.');

    console.log('\n[PRUEBA 2] Paquete cifrado opaco, confirmación y detección AEAD...');
    const iv = crypto.randomBytes(12);
    const secretContent = 'Mensaje confidencial de prueba E2EE VEL 0.1';
    const ciphertext = aesGcmEncrypt(sharedSessionKey, secretContent, iv);

    const receivedPayload = await withTimeout(
      new Promise<{ iv: string; ciphertext: string }>((resolve) => {
        termWs!.on('message', (msg) => {
          const data = JSON.parse(msg.toString());
          if (data.type === 'ENCRYPTED_MESSAGE') {
            resolve({ iv: data.iv, ciphertext: data.ciphertext });
          }
        });

        coreWs!.send(
          JSON.stringify({
            type: 'ENCRYPTED_MESSAGE',
            senderId: coreRec.deviceId,
            recipientId: termRec.deviceId,
            sessionId: linkId,
            operationId: 'op-test-101',
            iv: iv.toString('base64'),
            ciphertext: ciphertext.toString('base64'),
            timestamp: Date.now()
          })
        );
      }),
      2000,
      'Recepción paquete cifrado'
    );
    const decryptedText = aesGcmDecrypt(
      sharedSessionKey,
      Buffer.from(receivedPayload.iv, 'base64'),
      Buffer.from(receivedPayload.ciphertext, 'base64')
    );
    if (decryptedText !== secretContent) throw new Error('Descifrado incorrecto');
    console.log(' -> PASÓ: Mensaje descifrado correctamente.');

    console.log('\n[PRUEBA 3] Rechazo de /ws/{deviceId} sin desafío y de terminal no autorizado...');
    const rogueId = generateRandomDeviceId('TERMINAL');
    const pathRejected = await new Promise<boolean>((resolve) => {
      const s = new WebSocket(`${serverUrl}/ws/${rogueId}`);
      s.on('close', (c) => resolve(c === 4001));
    });
    if (!pathRejected) throw new Error('/ws/{deviceId} sin desafío debe rechazarse');
    console.log(' -> PASÓ: Ruta sin desafío rechazada.');

    console.log('\n[PRUEBA 4] Descarte offline y revocación persistente tras reinicio...');
    termWs.close();
    await new Promise((r) => setTimeout(r, 100));

    coreWs.send(
      JSON.stringify({
        type: 'REVOKE_DEVICE',
        coreId: coreRec.deviceId,
        targetTerminalId: termRec.deviceId,
        reason: 'Prueba revocación'
      })
    );
    await withTimeout(
      new Promise<void>((resolve) => {
        coreWs!.on('message', (raw) => {
          const d = JSON.parse(raw.toString());
          if (d.type === 'REVOCATION_CONFIRMED') resolve();
        });
      }),
      2000,
      'REVOCATION_CONFIRMED'
    );

    coreWs.close();
    await server.stop();

    const server2 = new VelRelayServer({
      port: 0,
      storageDir: testDataDir,
      deviceStore: db.store,
      verifyToken,
      hasDbCredentials: () => true,
      heartbeatIntervalMs: 60_000
    });
    const port2 = await server2.start();
    const blockedAfterRestart = await new Promise<boolean>((resolve) => {
      const s = new WebSocket(`ws://127.0.0.1:${port2}`);
      s.on('message', async (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.type === 'AUTH_CHALLENGE') {
          const ts = Date.now();
          const sig = await signRelayAuthChallenge(termMat.signingKeyPair.privateKey, m.challenge, termRec.deviceId, ts);
          s.send(
            JSON.stringify({
              type: 'AUTH',
              deviceId: termRec.deviceId,
              role: 'TERMINAL',
              fingerprint: termRec.fingerprint,
              firebaseIdToken: 'tok-uid-term-1',
              challenge: m.challenge,
              signatureBase64: sig,
              timestamp: ts
            })
          );
        }
      });
      s.on('close', (c) => resolve(c === 4003));
    });
    if (!blockedAfterRestart) throw new Error('Terminal revocado no fue bloqueado tras reinicio');
    await server2.stop();

    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    console.log(' -> PASÓ: Revocación persistente tras reinicio.');
    console.log('\n=== RESULTADO FINAL: TODAS LAS PRUEBAS DE server-vel/test-relay.ts PASARON ===\n');
  } finally {
    try {
      coreWs?.close();
      termWs?.close();
      await server.stop();
    } catch {}
  }
}

runAllRelayTests().catch((err) => {
  console.error('\n[FALLO EN PRUEBA]:', err);
  process.exit(1);
});
