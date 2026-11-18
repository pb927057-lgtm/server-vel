import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Smartphone,
  ArrowLeft,
  Lock,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Info,
  ChevronRight,
  ExternalLink,
  Download,
  HelpCircle,
  Radio,
  FileText,
  Key,
  Loader2,
  Send,
  Wifi,
  WifiOff,
  Copy,
  Database,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  DeviceIdentitySummary,
  DeviceRole,
  OperationDeliveryStatus,
  RelayConnectionState,
  RelayServerConfigResponse,
  RevocationStatus
} from './contracts/velContracts';
import {
  DeviceSetupResult,
  ROLE_CHANGE_CONFIRMATION_KEYWORD,
  SetupProgressStep,
  executeControlledRoleChange,
  loadPersistedDeviceIdentity,
  retryPendingDeviceRegistration,
  setupNewDeviceIdentity,
  syncPersistedDeviceSession
} from './services/deviceIdentityService';
import { getFreshDeviceAuthToken } from './services/firebase';
import { RelayClientSnapshot, VelRelayClient } from './services/relayClient';
import { OFFICIAL_CONTRACT_URL } from './services/firestore';
import { velOfflineSync } from './db/offlineSync';
import type { VelLocalRecord } from './db/db';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import {
  OfflineIndicator,
  PWAInstallButton,
  SWUpdateBanner
} from './components/PWAInstallBanner';
import { coreFileVault } from './db/coreFileVault';
import {
  FileTransferService,
  FileTransferSnapshot
} from './services/fileTransferService';
import { CoreBinaryVaultPanel } from './components/CoreBinaryVaultPanel';
import { MobileFileTransferPanel } from './components/MobileFileTransferPanel';

export type ScreenType =
  | 'WELCOME'
  | 'EXPLAIN_CORE'
  | 'EXPLAIN_MOVIL'
  | 'SECOND_PHONE_GUIDE'
  | 'SETUP_CORE'
  | 'SETUP_MOVIL'
  | 'CORE_HOME'
  | 'TERMINAL_HOME'
  | 'PAIRING_CORE'
  | 'DEVICE_MANAGEMENT'
  | 'REPLACE_PHONE';

export type { DeviceRole };

export function App() {
  // Modos de vista: PWA VEL (Dispositivo) e Instalación
  const [viewMode, setViewMode] = useState<'PHONE_PREVIEW' | 'INSTALL_INFO'>('PHONE_PREVIEW');
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('WELCOME');
  const [screenHistory, setScreenHistory] = useState<ScreenType[]>([]);

  // Modales de información, emergencia y cambio controlado de rol
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [showRoleChangeModal, setShowRoleChangeModal] = useState(false);
  const [roleChangeConfirmInput, setRoleChangeConfirmInput] = useState('');
  const [roleChangeError, setRoleChangeError] = useState<string | null>(null);
  const [isChangingRole, setIsChangingRole] = useState(false);

  // Apartados colapsables de información técnica avanzada (ocultos por defecto en la vista habitual)
  const [showSetupAdvancedTech, setShowSetupAdvancedTech] = useState(false);
  const [showCoreAdvancedTech, setShowCoreAdvancedTech] = useState(false);
  const [showTerminalAdvancedTech, setShowTerminalAdvancedTech] = useState(false);
  const [showPairingAdvancedTech, setShowPairingAdvancedTech] = useState(false);
  const [showManageAdvancedTech, setShowManageAdvancedTech] = useState(false);
  const [showReplaceAdvancedTech, setShowReplaceAdvancedTech] = useState(false);
  const [pairingFormError, setPairingFormError] = useState<string | null>(null);
  const [publicUrlCopyStatus, setPublicUrlCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const publicVelUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyPublicVelUrl = async () => {
    if (!publicVelUrl) {
      setPublicUrlCopyStatus('error');
      return;
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(publicVelUrl);
        setPublicUrlCopyStatus('copied');
        setTimeout(() => setPublicUrlCopyStatus('idle'), 2600);
        return;
      }
      const textarea = document.createElement('textarea');
      textarea.value = publicVelUrl;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (copied) {
        setPublicUrlCopyStatus('copied');
        setTimeout(() => setPublicUrlCopyStatus('idle'), 2600);
      } else {
        setPublicUrlCopyStatus('error');
      }
    } catch {
      setPublicUrlCopyStatus('error');
    }
  };

  const navigateTo = (next: ScreenType) => {
    setCurrentScreen((prev) => {
      if (prev !== next) {
        setScreenHistory((hist) => [...hist, prev]);
      }
      return next;
    });
  };

  const goBack = (fallback: ScreenType = 'WELCOME') => {
    setScreenHistory((hist) => {
      if (hist.length === 0) {
        setCurrentScreen(fallback);
        return hist;
      }
      const prev = hist[hist.length - 1];
      setCurrentScreen(prev);
      return hist.slice(0, -1);
    });
  };

  const goHome = () => {
    setViewMode('PHONE_PREVIEW');
    setScreenHistory([]);
    setRegistrationFeedback(null);
    setCurrentScreen('WELCOME');
  };

  // Estado real de identidad técnica del dispositivo (IndexedDB + Web Crypto + Firebase/Firestore)
  const [isLoadingIdentity, setIsLoadingIdentity] = useState(true);
  const [deviceIdentity, setDeviceIdentity] = useState<DeviceIdentitySummary | null>(null);
  const [setupSteps, setSetupSteps] = useState<SetupProgressStep[]>([]);
  const [isSettingUpDevice, setIsSettingUpDevice] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [requiresExternalConfig, setRequiresExternalConfig] = useState(false);
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const [registrationFeedback, setRegistrationFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    requiresConfig?: boolean;
  } | null>(null);

  const isActiveRegisteredCore = Boolean(
    deviceIdentity &&
      deviceIdentity.role === 'CORE' &&
      (deviceIdentity.registrationStatus === 'registered' ||
        deviceIdentity.registrationStatus === 'paired')
  );

  useEffect(() => {
    if (isLoadingIdentity) return;

    if (!deviceIdentity) {
      if (
        currentScreen === 'CORE_HOME' ||
        currentScreen === 'TERMINAL_HOME' ||
        currentScreen === 'PAIRING_CORE' ||
        currentScreen === 'DEVICE_MANAGEMENT' ||
        currentScreen === 'REPLACE_PHONE' ||
        currentScreen === 'SECOND_PHONE_GUIDE'
      ) {
        setCurrentScreen('WELCOME');
      }
      return;
    }

    if (currentScreen === 'EXPLAIN_CORE' && isActiveRegisteredCore) {
      setCurrentScreen('CORE_HOME');
      return;
    }

    if (
      deviceIdentity.role === 'TERMINAL' &&
      (currentScreen === 'CORE_HOME' ||
        currentScreen === 'PAIRING_CORE' ||
        currentScreen === 'DEVICE_MANAGEMENT' ||
        currentScreen === 'REPLACE_PHONE' ||
        currentScreen === 'SECOND_PHONE_GUIDE')
    ) {
      setCurrentScreen('TERMINAL_HOME');
      return;
    }

    if (deviceIdentity.role === 'CORE' && currentScreen === 'TERMINAL_HOME') {
      setCurrentScreen('CORE_HOME');
    }
  }, [isLoadingIdentity, currentScreen, deviceIdentity, isActiveRegisteredCore]);

  // PWA & Conectividad
  const pwa = usePWAInstall();
  const isOnline = useOnlineStatus();

  // Custodia local cifrada exclusiva de VEL CORE (IndexedDB + AES-256-GCM no exportable)
  const [coreVaultRecords, setCoreVaultRecords] = useState<VelLocalRecord[]>([]);
  const [vaultNoteTitle, setVaultNoteTitle] = useState('');
  const [vaultNoteBody, setVaultNoteBody] = useState('');
  const [isSavingVaultNote, setIsSavingVaultNote] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [decryptedVaultNote, setDecryptedVaultNote] = useState<{
    id: string;
    title: string;
    content: string;
    savedAt: string;
  } | null>(null);

  // Estado real del cliente Relay WebSocket y cifrado E2EE (Intervención 2)
  const relayClientRef = useRef<VelRelayClient | null>(null);
  if (!relayClientRef.current) {
    relayClientRef.current = new VelRelayClient();
  }
  const [relaySnapshot, setRelaySnapshot] = useState<RelayClientSnapshot>(() =>
    relayClientRef.current!.getSnapshot()
  );
  const [fileTransferService, setFileTransferService] = useState<FileTransferService | null>(null);
  const [fileTransferSnapshot, setFileTransferSnapshot] = useState<FileTransferSnapshot>({
    outgoing: [],
    incoming: [],
    hasActiveTransfer: false
  });
  const [coreBinaryVaultRevision, setCoreBinaryVaultRevision] = useState(0);
  const PRODUCTION_RELAY_WSS_URL = 'wss://server-vel.onrender.com';

  const getCompiledOrDefaultRelayConfig = (): RelayServerConfigResponse => {
    const viteConfigured = String((import.meta as any).env?.VITE_VEL_RELAY_WSS_URL || '').trim();
    if (/^wss?:\/\/.+/i.test(viteConfigured)) {
      return {
        configured: true,
        wssUrl: viteConfigured.replace(/\/+$/, ''),
        source: 'vite_env'
      };
    }
    return {
      configured: true,
      wssUrl: PRODUCTION_RELAY_WSS_URL,
      source: 'production_default'
    };
  };

  const [relayConfig, setRelayConfig] = useState<
    RelayServerConfigResponse & { loading: boolean }
  >(() => ({
    loading: true,
    ...getCompiledOrDefaultRelayConfig()
  }));
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [isStartingPairingOffer, setIsStartingPairingOffer] = useState(false);
  const [isClaimingPairing, setIsClaimingPairing] = useState(false);
  const [pairingCountdownSec, setPairingCountdownSec] = useState<number>(0);
  const [e2eeMessageInput, setE2eeMessageInput] = useState('');
  const [isSendingE2ee, setIsSendingE2ee] = useState(false);
  const [e2eeNotice, setE2eeNotice] = useState<string | null>(null);
  const [isRevokingPeer, setIsRevokingPeer] = useState(false);
  const [revokeFeedback, setRevokeFeedback] = useState<string | null>(null);
  const [copiedPairingCode, setCopiedPairingCode] = useState(false);

  const loadRelayConfiguration = async () => {
    const fallback = getCompiledOrDefaultRelayConfig();
    setRelayConfig((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/relay-config');
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && contentType.includes('application/json')) {
        const data = (await res.json()) as RelayServerConfigResponse;
        if (data.configured && data.wssUrl) {
          setRelayConfig({
            loading: false,
            configured: true,
            wssUrl: data.wssUrl.replace(/\/+$/, ''),
            source: data.source || 'env'
          });
          return;
        }
      }
      setRelayConfig({
        loading: false,
        ...fallback
      });
    } catch {
      setRelayConfig({
        loading: false,
        ...fallback
      });
    }
  };

  useEffect(() => {
    const client = relayClientRef.current!;
    const transferSvc = new FileTransferService({
      relayClient: client,
      coreVault: coreFileVault,
      onCoreVaultUpdated: () => setCoreBinaryVaultRevision((v) => v + 1)
    });
    setFileTransferService(transferSvc);
    const unsubscribeTransfer = transferSvc.subscribe((transferSnap) => {
      setFileTransferSnapshot(transferSnap);
    });
    const unsubscribe = client.subscribe((snap) => {
      setRelaySnapshot(snap);
      if (snap.identity) {
        setDeviceIdentity(snap.identity);
      }
    });
    void loadRelayConfiguration();

    return () => {
      unsubscribeTransfer();
      transferSvc.dispose();
      setFileTransferService(null);
      unsubscribe();
      client.disconnect();
    };
  }, []);

  // Reconexión automática controlada al volver la red o recuperar visibilidad de la PWA
  useEffect(() => {
    const syncAndReconnect = async () => {
      if (!deviceIdentity) return;
      try {
        const syncRes = await syncPersistedDeviceSession();
        if (syncRes) {
          setDeviceIdentity(syncRes.identity);
          if (syncRes.revoked) {
            relayClientRef.current?.disconnect();
            return;
          }
        }
      } catch {
        // Conserva estado local hasta que haya red estable
      }

      if (
        isOnline &&
        deviceIdentity.registrationStatus !== 'pending_local' &&
        deviceIdentity.registrationStatus !== 'revoked' &&
        relayConfig.configured &&
        relayConfig.wssUrl
      ) {
        const st = relayClientRef.current!.getState();
        if (st === 'DISCONNECTED' || st === 'ERROR') {
          relayClientRef.current!.connect(relayConfig.wssUrl, getFreshDeviceAuthToken);
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncAndReconnect();
      }
    };

    if (isOnline && deviceIdentity) {
      void syncAndReconnect();
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isOnline, deviceIdentity?.deviceId, deviceIdentity?.registrationStatus, relayConfig.configured, relayConfig.wssUrl]);

  useEffect(() => {
    const client = relayClientRef.current!;
    if (
      isOnline &&
      deviceIdentity &&
      deviceIdentity.registrationStatus !== 'pending_local' &&
      deviceIdentity.registrationStatus !== 'revoked' &&
      relayConfig.configured &&
      relayConfig.wssUrl
    ) {
      const currentState = client.getState();
      if (currentState === 'DISCONNECTED' || currentState === 'ERROR') {
        client.connect(relayConfig.wssUrl, getFreshDeviceAuthToken);
      }
    } else if (!deviceIdentity || deviceIdentity.registrationStatus === 'revoked') {
      if (client.getState() !== 'REVOKED' && client.getState() !== 'DISCONNECTED') {
        client.disconnect();
      }
    }
  }, [
    isOnline,
    deviceIdentity?.deviceId,
    deviceIdentity?.registrationStatus,
    relayConfig.configured,
    relayConfig.wssUrl
  ]);

  // Cargar registros locales cifrados exclusivamente cuando este dispositivo es VEL CORE
  const refreshCoreVaultRecords = async () => {
    if (deviceIdentity?.role !== 'CORE') {
      setCoreVaultRecords([]);
      return;
    }
    try {
      const list = await velOfflineSync.getAllRecords();
      setCoreVaultRecords(list.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch {
      setVaultError('No se pudo leer la bóveda local cifrada en IndexedDB.');
    }
  };

  useEffect(() => {
    if (deviceIdentity?.role === 'CORE' && currentScreen === 'CORE_HOME') {
      void refreshCoreVaultRecords();
    } else if (deviceIdentity?.role !== 'CORE') {
      setCoreVaultRecords([]);
      setDecryptedVaultNote(null);
    }
  }, [deviceIdentity?.role, currentScreen]);

  const handleSaveCoreVaultNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deviceIdentity?.role !== 'CORE') return;
    const title = vaultNoteTitle.trim() || 'Nota protegida';
    const content = vaultNoteBody.trim();
    if (!content) {
      setVaultError('Falta escribir el contenido que deseas guardar. Es obligatorio para protegerlo en tu VEL CORE.');
      return;
    }
    setIsSavingVaultNote(true);
    setVaultError(null);
    try {
      const id = `CORE-REC-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      await velOfflineSync.saveLocal(id, {
        title,
        content,
        savedAt: new Date().toISOString()
      });
      setVaultNoteTitle('');
      setVaultNoteBody('');
      await refreshCoreVaultRecords();
    } catch (err: any) {
      setVaultError(err?.message || 'Error al cifrar localmente con AES-256-GCM.');
    } finally {
      setIsSavingVaultNote(false);
    }
  };

  const handleOpenCoreVaultNote = async (id: string) => {
    if (deviceIdentity?.role !== 'CORE') return;
    setVaultError(null);
    const data = await velOfflineSync.getLocal<{ title?: string; content?: string; savedAt?: string }>(id);
    if (!data) {
      setVaultError('No se pudo descifrar este registro con la clave local no exportable.');
      return;
    }
    setDecryptedVaultNote({
      id,
      title: data.title || 'Registro CORE',
      content: data.content || (typeof data === 'string' ? data : JSON.stringify(data)),
      savedAt: data.savedAt || ''
    });
  };

  const handleDeleteCoreVaultNote = async (id: string) => {
    if (deviceIdentity?.role !== 'CORE') return;
    await velOfflineSync.removeRecord(id);
    if (decryptedVaultNote?.id === id) {
      setDecryptedVaultNote(null);
    }
    await refreshCoreVaultRecords();
  };

  const handleArchiveIncomingMessageInCore = async (text: string, operationId: string) => {
    if (deviceIdentity?.role !== 'CORE') return;
    setVaultError(null);
    try {
      await velOfflineSync.saveLocal(`E2EE-${operationId}`, {
        title: 'Mensaje E2EE recibido desde VEL MÓVIL',
        content: text,
        savedAt: new Date().toISOString()
      });
      await refreshCoreVaultRecords();
    } catch (err: any) {
      setVaultError(err?.message || 'No se pudo archivar localmente.');
    }
  };

  useEffect(() => {
    const expiresAt = relaySnapshot.pairingSession?.expiresAt;
    if (!expiresAt || relaySnapshot.pairingSession?.stage === 'CONFIRMED') {
      setPairingCountdownSec(0);
      return;
    }
    const updateTick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setPairingCountdownSec(remaining);
    };
    updateTick();
    const timer = setInterval(updateTick, 1000);
    return () => clearInterval(timer);
  }, [relaySnapshot.pairingSession?.expiresAt, relaySnapshot.pairingSession?.stage]);

  const handleReconnectRelay = () => {
    if (relayConfig.configured && relayConfig.wssUrl) {
      relayClientRef.current!.connect(relayConfig.wssUrl, getFreshDeviceAuthToken);
    } else {
      void loadRelayConfiguration();
    }
  };

  const handleCreatePairingOffer = async () => {
    setIsStartingPairingOffer(true);
    try {
      await relayClientRef.current!.createPairingOffer();
    } finally {
      setIsStartingPairingOffer(false);
    }
  };

  const handleClaimPairingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairingFormError(null);
    const cleanCode = pairingCodeInput.trim();
    if (!cleanCode) {
      setPairingFormError('Falta ingresar el código de invitación temporal de 8 caracteres (formato XXXX-XXXX). Solicítalo en «Vincular» desde tu VEL CORE.');
      return;
    }
    if (relaySnapshot.connectionState !== 'AUTHENTICATED') {
      setPairingFormError('El servicio de comunicación aún no está listo. Espera un momento o pulsa «Reconectar».');
      return;
    }
    setIsClaimingPairing(true);
    try {
      const outcome = await relayClientRef.current!.claimPairingOffer(cleanCode);
      if (!outcome.success && outcome.error) {
        setPairingFormError(outcome.error);
      }
    } finally {
      setIsClaimingPairing(false);
    }
  };

  const handleSendE2eeVerification = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const textToSend = (overrideText ?? e2eeMessageInput).trim();
    if (!textToSend) {
      setE2eeNotice('Falta escribir el mensaje. Es obligatorio ingresar un texto para enviarlo protegido a tu otro dispositivo.');
      return;
    }
    setIsSendingE2ee(true);
    setE2eeNotice(null);
    try {
      const outcome = await relayClientRef.current!.sendEncryptedMessage(
        textToSend,
        overrideText ? 'Reintento de envío' : textToSend.slice(0, 42)
      );
      if (!outcome.accepted) {
        setE2eeNotice(outcome.error || 'No se pudo enviar el mensaje en este momento.');
      } else if (!overrideText) {
        setE2eeMessageInput('');
      }
    } finally {
      setIsSendingE2ee(false);
    }
  };

  const handleRevokePeerDevice = async (reason: string) => {
    if (!deviceIdentity?.pairedPeerDeviceId) return;
    setIsRevokingPeer(true);
    setRevokeFeedback(null);
    try {
      const res = await relayClientRef.current!.revokePairedTerminal(
        deviceIdentity.pairedPeerDeviceId,
        reason
      );
      if (res.success && res.persistedInFirestore) {
        setRevokeFeedback(
          res.disconnectedLive
            ? '✓ Revocación confirmada: autorización invalidada en Firestore y VEL MÓVIL desconectado del Relay en vivo.'
            : '⚠ Revocación pendiente de desconexión en vivo: autorización invalidada en Firestore, pero el VEL MÓVIL estaba desconectado y será bloqueado al reconectar.'
        );
      } else {
        setRevokeFeedback(
          `✕ Estado desconocido: ${res.error || 'No se recibió confirmación del servidor sobre la revocación.'}`
        );
      }
    } finally {
      setIsRevokingPeer(false);
    }
  };

  const formatRevocationBadge = (status: RevocationStatus) => {
    switch (status) {
      case 'CONFIRMED':
        return { label: 'Revocación confirmada', cls: 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30' };
      case 'PERSISTED_PEER_OFFLINE':
      case 'PENDING':
        return { label: 'Revocación pendiente', cls: 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30' };
      case 'UNKNOWN':
        return { label: 'Estado desconocido', cls: 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30' };
      default:
        return null;
    }
  };

  const formatRelayBadge = (state: RelayConnectionState, peerOnline: boolean) => {
    switch (state) {
      case 'LINKED':
        return {
          label: peerOnline ? 'Vinculado E2EE (Par en línea)' : 'Vinculado E2EE (Par desconectado)',
          cls: peerOnline
            ? 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30'
            : 'bg-[#00CFE8]/15 text-[#00CFE8] border-[#00CFE8]/30'
        };
      case 'AUTHENTICATED':
        return { label: 'Relay conectado (esperando emparejamiento)', cls: 'bg-[#00CFE8]/15 text-[#00CFE8] border-[#00CFE8]/30' };
      case 'CONNECTING':
      case 'CONNECTED_UNAUTHENTICATED':
      case 'AUTHENTICATING':
        return { label: 'Autenticando en Relay...', cls: 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30' };
      case 'RECONNECTING':
        return { label: 'Reconectando Relay...', cls: 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30' };
      case 'REVOKED':
        return { label: 'Dispositivo revocado', cls: 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30' };
      case 'ERROR':
        return { label: 'Error de Relay', cls: 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30' };
      case 'DISCONNECTED':
      default:
        return { label: 'Relay desconectado', cls: 'bg-[#94A3B8]/15 text-[#94A3B8] border-[#94A3B8]/30' };
    }
  };

  const formatOpStatusLabel = (status: OperationDeliveryStatus) => {
    switch (status) {
      case 'SENDING':
        return { text: 'Enviando...', cls: 'text-[#00CFE8]' };
      case 'ROUTED_AWAITING_ACK':
        return { text: 'Enrutado (esperando confirmación)', cls: 'text-[#F59E0B]' };
      case 'CONFIRMED':
        return { text: 'Recibido y confirmado ✓', cls: 'text-[#10B981]' };
      case 'FAILED':
        return { text: 'Fallido (no encolado)', cls: 'text-[#EF4444]' };
      case 'UNKNOWN':
      default:
        return { text: 'Estado desconocido', cls: 'text-[#F59E0B]' };
    }
  };

  const formatFriendlyStepLabel = (step: SetupProgressStep['step'], status: SetupProgressStep['status']) => {
    switch (step) {
      case 'storage':
        return {
          title: 'Almacenamiento seguro del dispositivo',
          detail: status === 'done' ? 'Espacio protegido preparado en este teléfono.' : 'Preparando almacenamiento seguro...'
        };
      case 'crypto':
        return {
          title: 'Protección privada del dispositivo',
          detail: status === 'done' ? 'Claves de seguridad creadas y protegidas en este equipo.' : 'Generando protección privada...'
        };
      case 'firebase_auth':
        return {
          title: 'Verificación de acceso',
          detail:
            status === 'done'
              ? 'Sesión de dispositivo verificada sin contraseña.'
              : status === 'error'
              ? 'No se pudo verificar el acceso en este momento.'
              : 'Verificando acceso del dispositivo...'
        };
      case 'backend_register':
      default:
        return {
          title: 'Registro del dispositivo',
          detail:
            status === 'done'
              ? 'Dispositivo registrado correctamente.'
              : status === 'error'
              ? 'El registro en la nube quedó pendiente. Tus datos locales siguen a salvo.'
              : 'Completando registro en la nube...'
        };
    }
  };

  const formatRelaySimpleStatus = (state: RelayConnectionState) => {
    switch (state) {
      case 'LINKED':
      case 'AUTHENTICATED':
        return { label: 'Conectado', cls: 'text-[#10B981]' };
      case 'CONNECTING':
      case 'CONNECTED_UNAUTHENTICATED':
      case 'AUTHENTICATING':
      case 'RECONNECTING':
        return { label: 'Conectando...', cls: 'text-[#F59E0B]' };
      case 'REVOKED':
        return { label: 'Acceso revocado', cls: 'text-[#EF4444]' };
      case 'ERROR':
      case 'DISCONNECTED':
      default:
        return { label: 'Sin conexión', cls: 'text-[#94A3B8]' };
    }
  };

  const handleApplySetupOutcome = (result: DeviceSetupResult) => {
    if (result.identity) {
      setDeviceIdentity(result.identity);
      setSetupSteps(buildCompletedStepsForExisting(result.identity));
    }
    if (!result.success) {
      const errMsg = result.error || 'No se pudo completar el registro en la nube.';
      setSetupError(errMsg);
      setRequiresExternalConfig(Boolean(result.requiresExternalConfig));
      setRegistrationFeedback({
        type: 'error',
        message: errMsg,
        requiresConfig: Boolean(result.requiresExternalConfig)
      });
    } else {
      setSetupError(null);
      setRequiresExternalConfig(false);
      setRegistrationFeedback({
        type: 'success',
        message:
          result.identity?.role === 'CORE'
            ? 'VEL CORE registrado correctamente en la nube. Ya puedes continuar con la vinculación de tu teléfono MÓVIL.'
            : 'VEL MÓVIL registrado correctamente en la nube. Ya puedes vincularlo con tu VEL CORE.'
      });
    }
  };

  const buildCompletedStepsForExisting = (identity: DeviceIdentitySummary): SetupProgressStep[] => {
    const isRegistered = identity.registrationStatus !== 'pending_local';
    return [
      { step: 'storage', status: 'done', detail: 'Almacenamiento local listo.' },
      { step: 'crypto', status: 'done', detail: 'Identidad protegida en el dispositivo.' },
      { step: 'firebase_auth', status: identity.firebaseAuthUid ? 'done' : 'pending', detail: 'Acceso verificado.' },
      {
        step: 'backend_register',
        status: isRegistered ? 'done' : 'error',
        detail: isRegistered ? 'Dispositivo registrado.' : 'Registro remoto pendiente.'
      }
    ];
  };

  const handleStartDeviceSetup = async (role: DeviceRole) => {
    setSetupError(null);
    setRequiresExternalConfig(false);
    setRegistrationFeedback(null);

    // Si este dispositivo ya tiene una identidad guardada, conservarla intacta sin regenerar nada
    if (deviceIdentity) {
      setSetupSteps(buildCompletedStepsForExisting(deviceIdentity));
      if (deviceIdentity.role === role) {
        if (deviceIdentity.registrationStatus !== 'pending_local') {
          navigateTo(role === 'CORE' ? 'CORE_HOME' : 'TERMINAL_HOME');
          return;
        }
        navigateTo(role === 'CORE' ? 'SETUP_CORE' : 'SETUP_MOVIL');
        return;
      }
      // Si el usuario tiene CORE e intenta configurar MÓVIL (o viceversa), abrir pantalla explicativa con aviso sin sobrescribir IndexedDB ni redirigir al otro flujo
      navigateTo(role === 'CORE' ? 'EXPLAIN_CORE' : 'EXPLAIN_MOVIL');
      return;
    }

    setIsSettingUpDevice(true);
    navigateTo(role === 'CORE' ? 'SETUP_CORE' : 'SETUP_MOVIL');

    try {
      const result = await setupNewDeviceIdentity(role, (steps) => {
        setSetupSteps(steps);
      });
      handleApplySetupOutcome(result);
    } catch (err: any) {
      const errMsg = err?.message || 'Error inesperado al configurar este teléfono.';
      setSetupError(errMsg);
      setRegistrationFeedback({ type: 'error', message: errMsg });
    } finally {
      setIsSettingUpDevice(false);
    }
  };

  const handleRetryServerRegistration = async () => {
    if (isRetryingSync) return;
    setIsRetryingSync(true);
    setSetupError(null);
    setRegistrationFeedback(null);
    try {
      const result = await retryPendingDeviceRegistration();
      handleApplySetupOutcome(result);
    } catch (err: any) {
      const errMsg = err?.message || 'Error al reintentar el registro en la nube.';
      setSetupError(errMsg);
      setRegistrationFeedback({ type: 'error', message: errMsg });
    } finally {
      setIsRetryingSync(false);
    }
  };

  const handleRefreshDeviceSession = async () => {
    setIsRetryingSync(true);
    setSetupError(null);
    try {
      const syncRes = await syncPersistedDeviceSession();
      if (syncRes) {
        setDeviceIdentity(syncRes.identity);
        if (!syncRes.synced && syncRes.error) {
          setSetupError(syncRes.error);
        }
      }
    } catch (err: any) {
      setSetupError(err?.message || 'No se pudo comprobar el estado del dispositivo.');
    } finally {
      setIsRetryingSync(false);
    }
  };

  const handleExecuteControlledRoleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoleChangeError(null);
    if (!roleChangeConfirmInput.trim()) {
      setRoleChangeError(`Falta escribir exactamente ${ROLE_CHANGE_CONFIRMATION_KEYWORD}. Es necesario para confirmar el cambio de función de este teléfono.`);
      return;
    }
    setIsChangingRole(true);

    try {
      relayClientRef.current?.disconnect();
      const res = await executeControlledRoleChange(roleChangeConfirmInput);
      if (!res.success) {
        setRoleChangeError(res.error || 'Confirmación inválida.');
        return;
      }

      setDeviceIdentity(null);
      setSetupSteps([]);
      setSetupError(null);
      setRequiresExternalConfig(false);
      setRegistrationFeedback(null);
      setPairingCodeInput('');
      setRevokeFeedback(null);
      setRoleChangeConfirmInput('');
      setShowRoleChangeModal(false);
      setScreenHistory([]);
      setCurrentScreen('WELCOME');
    } catch (err: any) {
      setRoleChangeError(err?.message || 'No se pudo completar el cambio controlado de rol.');
    } finally {
      setIsChangingRole(false);
    }
  };


  // Restaurar identidad técnica persistida (IndexedDB) y completar posible retorno de Email Link
  useEffect(() => {
    let active = true;

    const readPersistedIdentityWithGuard = async () => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      try {
        return await Promise.race([
          loadPersistedDeviceIdentity(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error('Tiempo de espera agotado al leer la configuración local en IndexedDB.'));
            }, 3000);
          })
        ]);
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    };

    const bootstrapApp = async () => {
      try {
        const persisted = await readPersistedIdentityWithGuard();
        if (!active) return;

        if (persisted && (persisted.role === 'CORE' || persisted.role === 'TERMINAL')) {
          setDeviceIdentity(persisted);
          setSetupSteps(buildCompletedStepsForExisting(persisted));
          setScreenHistory([]);
          setCurrentScreen('WELCOME');
          setIsLoadingIdentity(false);

          // Sincronización silenciosa en segundo plano contra Firestore (/api/device-session)
          syncPersistedDeviceSession()
            .then((syncRes) => {
              if (!active || !syncRes) return;
              setDeviceIdentity(syncRes.identity);
              setSetupSteps(buildCompletedStepsForExisting(syncRes.identity));
              if (!syncRes.synced && syncRes.error) {
                setSetupError(syncRes.error);
                if (syncRes.requiresExternalConfig) {
                  setRequiresExternalConfig(true);
                }
              } else {
                setSetupError(null);
                setRequiresExternalConfig(false);
              }
            })
            .catch(() => {
              // Mantiene la identidad persistida localmente sin interrumpir el inicio
            });
        } else {
          setDeviceIdentity(null);
          setScreenHistory([]);
          setCurrentScreen('WELCOME');
          setIsLoadingIdentity(false);
        }
      } catch (err: any) {
        if (!active) return;
        setSetupError(err?.message || 'Error al cargar la configuración local.');
        setDeviceIdentity(null);
        setScreenHistory([]);
        setCurrentScreen('WELCOME');
        setIsLoadingIdentity(false);
      }

      // Detectar parámetro ?vista=instalar para abrir la vista de instalación PWA
      try {
        if (typeof window !== 'undefined' && window.location.search) {
          const params = new URLSearchParams(window.location.search);
          if (params.get('vista') === 'instalar') {
            setViewMode('INSTALL_INFO');
          }
        }
      } catch {
        // No interrumpir la pantalla inicial ante parámetros de URL no válidos
      }
    };

    bootstrapApp();
    return () => {
      active = false;
    };
  }, []);


  const registrationBadge = (() => {
    switch (deviceIdentity?.registrationStatus) {
      case 'registered':
      case 'paired':
        return { label: 'Registrada y activa', cls: 'text-[#10B981]' };
      case 'revoked':
        return { label: 'Acceso revocado', cls: 'text-[#EF4444]' };
      case 'pending_local':
      default:
        return { label: 'Registro pendiente', cls: 'text-[#F59E0B]' };
    }
  })();

  return (
    <div className="min-h-screen bg-[#0B1220] text-[#F1F5F9] flex flex-col font-sans selection:bg-[#00CFE8]/20">
      {/* Barra superior limpia */}
      <header className="h-14 border-b border-[#22324C] bg-[#111C2E]/90 backdrop-blur px-4 sm:px-6 flex items-center justify-between sticky top-0 z-50">
        <button
          type="button"
          onClick={goHome}
          className="flex items-center gap-3 text-left group cursor-pointer rounded-lg py-1 pr-2 hover:bg-[#18263E]/60 transition-colors"
          title="Ir a la pantalla de bienvenida"
          aria-label="VEL Inicio"
        >
          <div className="w-8 h-8 rounded-lg bg-[#18263E] border border-[#22324C] group-hover:border-[#00CFE8]/60 flex items-center justify-center text-[#00CFE8] transition-colors">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-wider text-white block leading-tight">VEL</span>
            <p className="text-[11px] text-[#94A3B8] hidden sm:block leading-tight">
              Protección inteligente de tu información personal.
            </p>
          </div>
        </button>

        {/* Pestañas de Vista */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('PHONE_PREVIEW')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              viewMode === 'PHONE_PREVIEW'
                ? 'bg-[#00CFE8] text-[#0B1220] font-bold shadow-md'
                : 'text-[#94A3B8] hover:text-white bg-[#18263E]'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">App VEL</span>
            <span className="sm:hidden">VEL</span>
          </button>


          <button
            onClick={() => setViewMode('INSTALL_INFO')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              viewMode === 'INSTALL_INFO'
                ? 'bg-[#00CFE8] text-[#0B1220] font-bold shadow-md'
                : 'text-[#94A3B8] hover:text-white bg-[#18263E]'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Instalar</span>
            <span className="sm:hidden">Instalar</span>
          </button>

          <PWAInstallButton pwa={pwa} compact />
        </div>
      </header>

      <SWUpdateBanner visible={pwa.swUpdateAvailable} onUpdate={pwa.applySwUpdate} />
      <OfflineIndicator isOnline={isOnline} />

      {/* Contenido principal */}
      <main className="flex-1 flex items-center justify-center p-3 sm:p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#111C2E] via-[#0B1220] to-[#070A11]">

        {/* ========================================================= */}
        {/* VISTA 1: APLICACIÓN WEB PROGRESIVA VEL (PWA) */}
        {/* ========================================================= */}
        {viewMode === 'PHONE_PREVIEW' && (
          <div className="flex items-center justify-center w-full">
            {/* Chasis del teléfono Android */}
            <div className="relative w-[375px] h-[780px] bg-[#070A11] rounded-[48px] p-3 shadow-2xl border-4 border-[#22324C] flex flex-col overflow-hidden">
              {/* Altavoz superior y cámara frontal */}
              <div className="absolute top-4 left-1/2 -translate-x-1/2 w-32 h-5 bg-[#0B1220] rounded-full flex items-center justify-center z-50 border border-[#22324C]/60">
                <div className="w-10 h-1 bg-[#22324C] rounded-full"></div>
              </div>

              {/* Pantalla del teléfono */}
              <div className="relative flex-1 bg-[#0B1220] rounded-[38px] flex flex-col pt-7 pb-3 overflow-hidden">

                {/* BOTÓN (ⓘ) DE INFORMACIÓN Y AYUDA */}
                <div className="absolute top-3 right-4 z-40">
                  <button
                    onClick={() => setShowHelpModal(true)}
                    className="w-7 h-7 rounded-full bg-[#111C2E] border border-[#22324C] text-[#94A3B8] hover:text-[#00CFE8] flex items-center justify-center transition-colors cursor-pointer"
                    title="Información y ayuda"
                    aria-label="Información y ayuda"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </div>

                {/* ============================================== */}
                {/* 0. CARGA INICIAL DE IDENTIDAD PERSISTIDA */}
                {/* ============================================== */}
                {isLoadingIdentity && (
                  <div className="flex-1 px-5 py-6 flex flex-col items-center justify-center text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#111C2E] border border-[#22324C] flex items-center justify-center text-[#00CFE8]">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-sm font-bold text-white">Verificando identidad técnica</h2>
                      <p className="text-[11px] text-[#94A3B8]">
                        Leyendo configuración local protegida en IndexedDB...
                      </p>
                    </div>
                  </div>
                )}

                {/* ============================================== */}
                {/* 1. PANTALLA: BIENVENIDA PRINCIPAL VEL */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'WELCOME' && (
                  <div className="flex-1 px-4 py-2 flex flex-col justify-between space-y-2 overflow-y-auto">
                    <div className="space-y-2">
                      {/* Encabezado: Logo Oficial + Bienvenida + Presentación */}
                      <div className="flex flex-col items-center text-center space-y-1.5">
                        <div className="w-10 h-10 rounded-2xl bg-[#111C2E] border border-[#22324C] flex items-center justify-center shadow-lg">
                          <svg className="w-7 h-7" viewBox="0 0 100 100" fill="none">
                            <path d="M50 15L85 85H70L50 45L30 85H15L50 15Z" fill="#00CFE8" />
                            <circle cx="50" cy="35" r="5" fill="#FFFFFF" />
                          </svg>
                        </div>

                        <div className="space-y-0.5">
                          <h1 className="text-base font-extrabold tracking-tight text-white">
                            BIENVENIDO A VEL
                          </h1>
                          <p className="text-[10.5px] text-[#E2E8F0] leading-snug px-1">
                            VEL te permite proteger tu información personal mediante dos teléfonos con funciones complementarias: uno conserva tus datos resguardados y el otro los utiliza de forma segura cada día.
                          </p>
                        </div>
                      </div>

                      {/* Aviso si este teléfono ya está configurado como VEL CORE */}
                      {deviceIdentity && deviceIdentity.role === 'CORE' && (
                        <div className="p-2 rounded-2xl bg-[#111C2E] border border-[#00CFE8]/35">
                          <div className="flex items-center justify-center gap-1.5 text-[10.5px] text-[#CBD5E1]">
                            <CheckCircle className="w-3.5 h-3.5 shrink-0 text-[#00CFE8]" />
                            <span>Este teléfono ya está configurado como VEL CORE.</span>
                          </div>
                        </div>
                      )}

                      {deviceIdentity && deviceIdentity.role === 'TERMINAL' && (
                        <div className="p-2 rounded-2xl bg-[#111C2E] border border-[#10B981]/35 space-y-1.5">
                          <div className="flex items-center justify-center gap-1.5 text-[10.5px] text-[#CBD5E1]">
                            <CheckCircle className="w-3.5 h-3.5 shrink-0 text-[#10B981]" />
                            <span>Este teléfono ya está configurado como VEL MÓVIL.</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => navigateTo('TERMINAL_HOME')}
                            className="w-full h-8 rounded-xl font-extrabold text-[11px] tracking-wide transition-all shadow cursor-pointer flex items-center justify-center gap-2 bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220]"
                          >
                            <Smartphone className="w-3.5 h-3.5" />
                            <span>IR A MI PANEL VEL MÓVIL</span>
                          </button>
                        </div>
                      )}

                      {/* Cómo funciona VEL */}
                      <div className="p-2.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-1.5">
                        <span className="text-[9.5px] font-extrabold tracking-wide text-[#00CFE8] block leading-snug">
                          VEL FUNCIONA CON DOS TELÉFONOS Y SE DEBE DESCARGAR EN CADA TELÉFONO LA APP VEL.
                        </span>

                        <div className="p-2 rounded-xl bg-[#0B1220] border border-[#00CFE8]/25 space-y-0.5">
                          <span className="text-[10.5px] font-bold text-white block">
                            VEL CORE — Teléfono principal
                          </span>
                          <p className="text-[10.5px] text-[#CBD5E1] leading-snug">
                            Es el dispositivo que conserva y protege la información personal cifrada localmente.
                          </p>
                        </div>

                        <div className="p-2 rounded-xl bg-[#0B1220] border border-[#10B981]/25 space-y-0.5">
                          <span className="text-[10.5px] font-bold text-white block">
                            VEL MÓVIL — Teléfono de uso diario
                          </span>
                          <p className="text-[10.5px] text-[#CBD5E1] leading-snug">
                            Permite utilizar la información protegida por CORE mediante una conexión segura, sin conservar copias personales.
                          </p>
                        </div>
                      </div>

                      {/* Instrucciones antes de elegir el dispositivo */}
                      <div className="p-2.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-1">
                        <span className="text-[9.5px] font-extrabold tracking-wide text-white block leading-snug">
                          PRIMERO, IDENTIFICA QUÉ TELÉFONO VAS A CONFIGURAR
                        </span>
                        <ul className="space-y-0.5 text-[10.5px] text-[#CBD5E1] leading-snug list-disc list-inside">
                          <li>
                            Si este es tu teléfono principal, selecciona <strong className="text-[#00CFE8]">VEL CORE</strong> y realiza su configuración.
                          </li>
                          <li>
                            Si este es tu teléfono de uso diario, selecciona <strong className="text-[#10B981]">VEL MÓVIL</strong> y sigue las instrucciones para vincularlo con el teléfono CORE.
                          </li>
                        </ul>
                        <p className="text-[9.5px] text-[#94A3B8] leading-snug">
                          Primero debe configurarse <strong className="text-white">VEL CORE</strong> en tu teléfono principal y posteriormente vincularse <strong className="text-white">VEL MÓVIL</strong> desde un segundo teléfono.
                        </p>
                      </div>

                      {/* Dos opciones independientes de selección de dispositivo (orden: CORE primero, luego MÓVIL) */}
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => {
                            navigateTo('EXPLAIN_CORE');
                          }}
                          className="w-full p-2.5 rounded-2xl bg-[#111C2E] hover:bg-[#18263E] border-2 border-[#00CFE8]/50 hover:border-[#00CFE8] text-left transition-all active:scale-[0.99] cursor-pointer shadow-lg flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-[#00CFE8]/15 border border-[#00CFE8]/40 flex items-center justify-center text-[#00CFE8] shrink-0">
                              <Shield className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-extrabold tracking-wide text-white">
                                  CONFIGURAR VEL CORE
                                </span>
                              </div>
                              <span className="text-[10px] text-[#94A3B8] block leading-tight">
                                Teléfono principal
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#00CFE8] shrink-0" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (deviceIdentity?.role === 'TERMINAL') {
                              navigateTo('TERMINAL_HOME');
                              return;
                            }
                            navigateTo('EXPLAIN_MOVIL');
                          }}
                          className="w-full p-2.5 rounded-2xl bg-[#111C2E] hover:bg-[#18263E] border-2 border-[#10B981]/50 hover:border-[#10B981] text-left transition-all active:scale-[0.99] cursor-pointer shadow-lg flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-[#10B981]/15 border border-[#10B981]/40 flex items-center justify-center text-[#10B981] shrink-0">
                              <Smartphone className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-extrabold tracking-wide text-white">
                                  CONFIGURAR VEL MÓVIL
                                </span>
                                {deviceIdentity?.role === 'TERMINAL' && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/35">
                                    Activo
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-[#94A3B8] block leading-tight">
                                Teléfono de uso diario
                              </span>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#10B981] shrink-0" />
                        </button>
                      </div>
                    </div>

                    {/* Pie: Enlace a términos y condiciones */}
                    <div className="pt-1 pb-0.5 text-center">
                      <a
                        href={OFFICIAL_CONTRACT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-[#94A3B8] hover:text-[#00CFE8] transition-colors inline-flex items-center gap-1 cursor-pointer"
                      >
                        <FileText className="w-3 h-3" />
                        <span>Consultar términos y condiciones</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                )}

                {/* ============================================== */}
                {/* 1.0A PANTALLA EXPLICATIVA: SELECCIÓN VEL CORE */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'EXPLAIN_CORE' && !isActiveRegisteredCore && (
                  <div className="flex-1 px-5 py-4 flex flex-col justify-between space-y-3 overflow-y-auto">
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => goBack('WELCOME')}
                        className="h-9 px-3 rounded-xl text-[#00CFE8] hover:text-white bg-[#111C2E] border border-[#22324C] inline-flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-sm"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>VOLVER</span>
                      </button>

                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-[#00CFE8]/15 border border-[#00CFE8]/40 flex items-center justify-center text-[#00CFE8] shrink-0">
                          <Shield className="w-5 h-5" />
                        </div>
                        <div>
                          <h2 className="text-base font-extrabold text-white leading-tight">
                            Configuración de VEL CORE
                          </h2>
                          <p className="text-[11px] text-[#00CFE8] font-semibold">
                            Primer teléfono · Custodio principal
                          </p>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#00CFE8]/30 space-y-2">
                        <span className="text-xs font-bold text-white block">
                          Función de VEL CORE
                        </span>
                        <p className="text-xs text-[#CBD5E1] leading-relaxed">
                          Es tu teléfono principal. Conserva y protege tu información personal cifrada dentro del propio dispositivo y autoriza la conexión de tu teléfono móvil diario.
                        </p>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2 text-xs">
                        <span className="font-bold text-white block">
                          Pasos de configuración
                        </span>
                        <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-[#CBD5E1] leading-relaxed">
                          <li>Crear el almacenamiento seguro y las claves privadas protegidas de este teléfono.</li>
                          <li>Registrar la identidad técnica del teléfono principal sin subir datos personales.</li>
                          <li>Acceder al panel VEL CORE, desde donde luego podrás vincular tu segundo teléfono.</li>
                        </ol>
                      </div>

                      {deviceIdentity && deviceIdentity.role !== 'CORE' && (
                        <div className="p-3.5 rounded-2xl bg-[#F59E0B]/10 border border-[#F59E0B]/40 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[#F59E0B] font-bold text-xs">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>Este teléfono ya es VEL MÓVIL</span>
                          </div>
                          <p className="text-[11px] text-[#E2E8F0] leading-relaxed">
                            Para configurar VEL CORE debes utilizar tu teléfono principal. No se modificó ni sobrescribió tu identidad actual de VEL MÓVIL.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 pt-1">
                      {!deviceIdentity || deviceIdentity.role === 'CORE' ? (
                        <button
                          type="button"
                          onClick={() => void handleStartDeviceSetup('CORE')}
                          disabled={isSettingUpDevice}
                          className="w-full h-11 rounded-xl bg-[#00CFE8] hover:bg-[#00b8ce] text-[#0B1220] font-extrabold text-xs tracking-wide transition-all shadow-md active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 px-3 disabled:opacity-60"
                        >
                          <Shield className="w-4 h-4 shrink-0" />
                          <span>CONTINUAR CON CONFIGURACIÓN CORE</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => navigateTo('TERMINAL_HOME')}
                          className="w-full h-11 rounded-xl bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-extrabold text-xs cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Smartphone className="w-4 h-4 shrink-0" />
                          <span>IR A MI PANEL VEL MÓVIL</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* ============================================== */}
                {/* 1.0B PANTALLA EXPLICATIVA: SELECCIÓN VEL MÓVIL */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'EXPLAIN_MOVIL' && (
                  <div className="flex-1 px-5 py-4 flex flex-col justify-between space-y-3 overflow-y-auto">
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => goBack('WELCOME')}
                        className="h-9 px-3 rounded-xl text-[#00CFE8] hover:text-white bg-[#111C2E] border border-[#22324C] inline-flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-sm"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>VOLVER</span>
                      </button>

                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-[#10B981]/15 border border-[#10B981]/40 flex items-center justify-center text-[#10B981] shrink-0">
                          <Smartphone className="w-5 h-5" />
                        </div>
                        <div>
                          <h2 className="text-base font-extrabold text-white leading-tight">
                            Configuración de VEL MÓVIL
                          </h2>
                          <p className="text-[11px] text-[#10B981] font-semibold">
                            Segundo teléfono · Uso diario
                          </p>
                        </div>
                      </div>

                      {deviceIdentity?.role === 'CORE' && (
                        <div className="p-3.5 rounded-2xl bg-[#F59E0B]/15 border-2 border-[#F59E0B]/60 space-y-2">
                          <div className="flex items-center gap-1.5 text-[#F59E0B] font-extrabold text-xs">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>Debes utilizar otro teléfono</span>
                          </div>
                          <p className="text-[11px] text-[#F1F5F9] leading-relaxed">
                            Este dispositivo ya está configurado como <strong>VEL CORE</strong>. Para configurar <strong>VEL MÓVIL</strong> debes abrir VEL en un segundo teléfono diferente.
                          </p>
                          <p className="text-[11px] text-[#CBD5E1] leading-snug">
                            No se cambió tu rol ni se modificó tu identidad VEL CORE.
                          </p>

                          <div className="pt-1 space-y-1.5">
                            <div className="p-2 rounded-lg bg-[#0B1220] border border-[#22324C] text-[10px] font-mono text-[#00CFE8] break-all select-all">
                              {publicVelUrl || 'Dirección no disponible'}
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleCopyPublicVelUrl()}
                              className="w-full h-8 rounded-lg bg-[#18263E] hover:bg-[#22324C] border border-[#00CFE8]/40 text-[#00CFE8] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" />
                              <span>COPIAR DIRECCIÓN PARA EL OTRO TELÉFONO</span>
                            </button>
                            {publicUrlCopyStatus === 'copied' && (
                              <p className="text-[10px] font-semibold text-[#10B981] text-center">
                                ✓ Dirección copiada al portapapeles
                              </p>
                            )}
                            {publicUrlCopyStatus === 'error' && (
                              <p className="text-[10px] text-[#F59E0B] text-center">
                                No se pudo copiar automáticamente; copia manualmente la dirección mostrada.
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#10B981]/30 space-y-2">
                        <span className="text-xs font-bold text-white block">
                          Importante: segundo teléfono independiente
                        </span>
                        <p className="text-xs text-[#CBD5E1] leading-relaxed">
                          VEL MÓVIL debe configurarse en un teléfono distinto del que tiene VEL CORE. Te permite utilizar la información protegida por CORE sin guardar copias personales en este teléfono.
                        </p>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2 text-xs">
                        <span className="font-bold text-white block">
                          Pasos en este segundo teléfono
                        </span>
                        <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-[#CBD5E1] leading-relaxed">
                          <li>Generar la identidad técnica independiente de este teléfono móvil.</li>
                          <li>Ingresar en el panel VEL MÓVIL el código temporal de 8 caracteres generado en VEL CORE.</li>
                          <li>Confirmar cara a cara en ambos teléfonos el código de seguridad SAS de 6 dígitos.</li>
                        </ol>
                      </div>

                      {deviceIdentity?.role === 'TERMINAL' && (
                        <div className="p-3 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 text-xs text-[#10B981] space-y-1">
                          <strong>✓ VEL MÓVIL ya está configurado en este teléfono</strong>
                          <p className="text-[11px] text-[#CBD5E1]">
                            Tu identidad MÓVIL se conserva intacta.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 pt-1">
                      {!deviceIdentity ? (
                        <button
                          type="button"
                          onClick={() => void handleStartDeviceSetup('TERMINAL')}
                          disabled={isSettingUpDevice}
                          className="w-full h-11 rounded-xl bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-extrabold text-xs tracking-wide transition-all shadow-md active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 px-3 disabled:opacity-60"
                        >
                          <Smartphone className="w-4 h-4 shrink-0" />
                          <span>CONTINUAR CON CONFIGURACIÓN MÓVIL</span>
                        </button>
                      ) : deviceIdentity.role === 'TERMINAL' ? (
                        <button
                          type="button"
                          onClick={() => navigateTo('TERMINAL_HOME')}
                          className="w-full h-11 rounded-xl bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-extrabold text-xs cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Smartphone className="w-4 h-4 shrink-0" />
                          <span>IR A MI PANEL VEL MÓVIL</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => goBack('WELCOME')}
                          className="w-full h-10 rounded-xl bg-[#18263E] hover:bg-[#22324C] border border-[#22324C] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>VOLVER AL INICIO</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* ============================================== */}
                {/* 1.0C PANTALLA: GUÍA PARA SEGUNDO TELÉFONO DESDE CORE */}
                {/* ============================================== */}
                {!isLoadingIdentity &&
                  currentScreen === 'SECOND_PHONE_GUIDE' &&
                  deviceIdentity?.role === 'CORE' && (
                    <div className="flex-1 px-5 py-4 flex flex-col justify-between space-y-3 overflow-y-auto">
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => goBack('CORE_HOME')}
                          className="h-9 px-3 rounded-xl text-[#00CFE8] hover:text-white bg-[#111C2E] border border-[#22324C] inline-flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-sm"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>VOLVER</span>
                        </button>

                        <div className="space-y-1">
                          <h2 className="text-base font-extrabold text-white">
                            Configurar VEL MÓVIL en otro teléfono
                          </h2>
                          <p className="text-xs text-[#CBD5E1] leading-relaxed">
                            VEL CORE ya está configurado en este teléfono. Para utilizar VEL MÓVIL necesitas un segundo teléfono. Instala VEL en ese dispositivo, abre la aplicación desde su ícono y sigue la guía de configuración.
                          </p>
                        </div>

                        <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2.5">
                          <span className="text-[11px] font-bold text-white block">
                            Dirección oficial para abrir en tu segundo teléfono
                          </span>

                          <div className="p-2.5 rounded-xl bg-[#0B1220] border border-[#22324C] text-[11px] font-mono text-[#00CFE8] break-all select-all">
                            {publicVelUrl || 'Dirección no disponible'}
                          </div>

                          <button
                            type="button"
                            onClick={() => void handleCopyPublicVelUrl()}
                            className="w-full h-10 rounded-xl bg-[#00CFE8] hover:bg-[#00b8ce] text-[#0B1220] font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer shadow"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>COPIAR DIRECCIÓN DE VEL</span>
                          </button>

                          {publicUrlCopyStatus === 'copied' && (
                            <p className="text-[11px] font-semibold text-[#10B981] text-center">
                              ✓ Dirección copiada al portapapeles
                            </p>
                          )}

                          {publicUrlCopyStatus === 'error' && (
                            <p className="text-[11px] text-[#F59E0B] leading-snug text-center">
                              No se pudo copiar automáticamente al portapapeles. Selecciona y copia manualmente la dirección mostrada arriba.
                            </p>
                          )}
                        </div>

                        <div className="p-3 rounded-2xl bg-[#111C2E] border border-[#10B981]/30 space-y-1.5 text-[11px] text-[#CBD5E1]">
                          <span className="font-bold text-[#10B981] block">
                            Pasos en el segundo teléfono:
                          </span>
                          <ol className="list-decimal list-inside space-y-1 leading-snug text-[#94A3B8]">
                            <li>Abre esa dirección en el navegador de tu segundo teléfono.</li>
                            <li>Instala VEL en su pantalla de inicio y ábrela desde su ícono.</li>
                            <li>Toca <strong className="text-white">VEL MÓVIL</strong> y luego <strong className="text-white">CONTINUAR CON CONFIGURACIÓN MÓVIL</strong>.</li>
                            <li>Cuando esté listo, regresa aquí a VEL CORE para iniciar la vinculación.</li>
                          </ol>
                        </div>

                        <button
                          type="button"
                          onClick={() => navigateTo('PAIRING_CORE')}
                          className="w-full h-9 rounded-xl bg-[#0B1220] hover:bg-[#18263E] border border-[#00CFE8]/40 text-[#00CFE8] font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Ir a vincular cuando el móvil esté listo</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => goBack('CORE_HOME')}
                        className="w-full h-10 rounded-xl bg-[#18263E] hover:bg-[#22324C] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>VOLVER</span>
                      </button>
                    </div>
                  )}

                {/* ============================================== */}
                {/* 1.1 CONFIGURACIÓN: VEL CORE */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'SETUP_CORE' && (
                  <div className="flex-1 px-5 py-4 flex flex-col justify-between space-y-3 overflow-y-auto">
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => goBack('WELCOME')}
                        className="h-9 px-3 rounded-xl text-[#00CFE8] hover:text-white bg-[#111C2E] border border-[#22324C] inline-flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-sm"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>VOLVER</span>
                      </button>

                      {deviceIdentity && deviceIdentity.role !== 'CORE' ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <h2 className="text-base font-bold text-white">Este teléfono ya es VEL MÓVIL</h2>
                            <p className="text-xs text-[#94A3B8] leading-relaxed">
                              Tu configuración actual de VEL MÓVIL se conserva intacta y no fue modificada.
                            </p>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#10B981]/30 space-y-2 text-xs text-[#94A3B8] leading-relaxed">
                            <p>
                              Para usar <strong className="text-white">VEL CORE</strong>, abre VEL en tu teléfono principal, selecciona{' '}
                              <strong className="text-[#00CFE8]">VEL CORE</strong> y luego{' '}
                              <strong className="text-[#00CFE8]">CONTINUAR CON CONFIGURACIÓN CORE</strong>.
                            </p>
                            <p>
                              Si realmente deseas cambiar la función de este teléfono, puedes hacerlo desde tu panel usando la opción de cambio controlado de rol.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-0.5">
                            <h2 className="text-base font-bold text-white">Configuración de VEL CORE</h2>
                            <p className="text-xs text-[#94A3B8]">
                              Preparando este dispositivo como teléfono principal de protección.
                            </p>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2.5">
                            {setupSteps.map((s) => {
                              const friendly = formatFriendlyStepLabel(s.step, s.status);
                              return (
                                <div key={s.step} className="space-y-0.5">
                                  <div
                                    className={`flex items-center gap-2 font-bold text-xs ${
                                      s.status === 'done'
                                        ? 'text-[#10B981]'
                                        : s.status === 'error'
                                        ? 'text-[#F59E0B]'
                                        : s.status === 'in_progress'
                                        ? 'text-[#00CFE8]'
                                        : 'text-[#94A3B8]'
                                    }`}
                                  >
                                    {s.status === 'in_progress' ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                    ) : s.status === 'error' ? (
                                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    ) : (
                                      <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                                    )}
                                    <span>{friendly.title}</span>
                                  </div>
                                  <p className="text-[11px] text-[#94A3B8] leading-snug pl-5">{friendly.detail}</p>
                                </div>
                              );
                            })}
                          </div>

                          {!isSettingUpDevice && deviceIdentity?.registrationStatus !== 'pending_local' && deviceIdentity && (
                            <div className="p-3 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 text-xs text-[#10B981] space-y-1">
                              <strong>✓ VEL CORE listo para usar</strong>
                              <p className="text-[11px] text-white/90">
                                La protección local quedó guardada en este teléfono de forma segura.
                              </p>
                            </div>
                          )}

                          {!isSettingUpDevice && setupError && (
                            <div className="p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#F59E0B] space-y-2">
                              <p className="text-[11px] leading-snug">
                                <strong>Registro en la nube pendiente:</strong> Tus claves locales siguen protegidas.
                              </p>
                              <p className="text-[11px] text-[#FCA5A5] bg-[#0B1220] p-2 rounded-lg border border-[#EF4444]/30 leading-snug break-words">
                                {setupError}
                              </p>
                              <button
                                type="button"
                                onClick={handleRetryServerRegistration}
                                disabled={isRetryingSync}
                                className="w-full h-8 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-[#0B1220] font-bold text-[11px] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                              >
                                {isRetryingSync && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <span>{isRetryingSync ? 'Registrando en la nube...' : 'Reintentar registro'}</span>
                              </button>
                            </div>
                          )}

                          {deviceIdentity && (
                            <div className="rounded-xl bg-[#0B1220] border border-[#22324C] overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setShowSetupAdvancedTech((prev) => !prev)}
                                className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-[#94A3B8] hover:text-white cursor-pointer"
                              >
                                <span>Información técnica avanzada</span>
                                {showSetupAdvancedTech ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                              {showSetupAdvancedTech && (
                                <div className="px-3 pb-2.5 pt-1 border-t border-[#22324C] space-y-1 font-mono text-[10px] text-[#94A3B8]">
                                  <div className="flex justify-between gap-2">
                                    <span>ID asignado:</span>
                                    <strong className="text-white truncate">{deviceIdentity.deviceId}</strong>
                                  </div>
                                  <div className="flex justify-between gap-2">
                                    <span>Huella SHA-256:</span>
                                    <span className="text-[#00CFE8]">{deviceIdentity.fingerprint.slice(0, 17)}...</span>
                                  </div>
                                  <div className="flex justify-between gap-2">
                                    <span>Estado técnico:</span>
                                    <span className="text-white">{deviceIdentity.registrationStatus}</span>
                                  </div>
                                  {setupError && (
                                    <p className="text-[10px] text-[#F59E0B] pt-1 font-sans">{setupError}</p>
                                  )}
                                  {requiresExternalConfig && (
                                    <p className="text-[10px] text-[#94A3B8] font-sans">
                                      Requiere configuración de autenticación y backend activa.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="space-y-2">
                      {deviceIdentity && deviceIdentity.role !== 'CORE' ? (
                        <button
                          type="button"
                          onClick={() => navigateTo('TERMINAL_HOME')}
                          className="w-full h-11 rounded-xl bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-extrabold text-xs transition-all shadow cursor-pointer"
                        >
                          IR A MI PANEL VEL MÓVIL
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isSettingUpDevice || !deviceIdentity}
                          onClick={() => navigateTo('CORE_HOME')}
                          className="w-full h-11 rounded-xl bg-[#00CFE8] hover:bg-[#00b8ce] text-[#0B1220] font-extrabold text-xs transition-all shadow cursor-pointer disabled:opacity-50"
                        >
                          {isSettingUpDevice ? 'CONFIGURANDO VEL CORE...' : 'ACCEDER AL PANEL DE VEL CORE'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* ============================================== */}
                {/* 1.2 CONFIGURACIÓN: VEL MÓVIL */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'SETUP_MOVIL' && (
                  <div className="flex-1 px-5 py-4 flex flex-col justify-between space-y-3 overflow-y-auto">
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => goBack('WELCOME')}
                        className="h-9 px-3 rounded-xl text-[#00CFE8] hover:text-white bg-[#111C2E] border border-[#22324C] inline-flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-sm"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>VOLVER</span>
                      </button>

                      {deviceIdentity && deviceIdentity.role === 'CORE' ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <h2 className="text-base font-bold text-white">Este teléfono ya es VEL CORE</h2>
                            <p className="text-xs text-[#94A3B8] leading-relaxed">
                              Tu identidad principal y tu bóveda local siguen intactas y protegidas en este navegador.
                            </p>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#00CFE8]/30 space-y-2 text-xs text-[#94A3B8] leading-relaxed">
                            <p>
                              <strong className="text-white">VEL MÓVIL</strong> se configura en tu segundo teléfono (el de uso diario) abriendo VEL, seleccionando{' '}
                              <strong className="text-[#10B981]">VEL MÓVIL</strong> y luego{' '}
                              <strong className="text-[#10B981]">CONTINUAR CON CONFIGURACIÓN MÓVIL</strong>.
                            </p>
                            <p>
                              Si deseas sustituir tu teléfono móvil anterior o vincular uno nuevo, hazlo desde tu panel de VEL CORE.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-0.5">
                            <h2 className="text-base font-bold text-white">Configuración de VEL MÓVIL</h2>
                            <p className="text-xs text-[#94A3B8]">
                              Preparando este teléfono para conectarse de forma segura con tu VEL CORE.
                            </p>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2.5">
                            {setupSteps.map((s) => {
                              const friendly = formatFriendlyStepLabel(s.step, s.status);
                              return (
                                <div key={s.step} className="space-y-0.5">
                                  <div
                                    className={`flex items-center gap-2 font-bold text-xs ${
                                      s.status === 'done'
                                        ? 'text-[#10B981]'
                                        : s.status === 'error'
                                        ? 'text-[#F59E0B]'
                                        : s.status === 'in_progress'
                                        ? 'text-[#00CFE8]'
                                        : 'text-[#94A3B8]'
                                    }`}
                                  >
                                    {s.status === 'in_progress' ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                    ) : s.status === 'error' ? (
                                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    ) : (
                                      <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                                    )}
                                    <span>{friendly.title}</span>
                                  </div>
                                  <p className="text-[11px] text-[#94A3B8] leading-snug pl-5">{friendly.detail}</p>
                                </div>
                              );
                            })}
                          </div>

                          {!isSettingUpDevice && setupError && (
                            <div className="p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#F59E0B] space-y-2">
                              <p className="text-[11px] leading-snug">
                                <strong>Registro en la nube pendiente:</strong> Tu identificación local sigue lista.
                              </p>
                              <p className="text-[11px] text-[#FCA5A5] bg-[#0B1220] p-2 rounded-lg border border-[#EF4444]/30 leading-snug break-words">
                                {setupError}
                              </p>
                              <button
                                type="button"
                                onClick={handleRetryServerRegistration}
                                disabled={isRetryingSync}
                                className="w-full h-8 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-[#0B1220] font-bold text-[11px] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                              >
                                {isRetryingSync && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <span>{isRetryingSync ? 'Registrando en la nube...' : 'Reintentar registro'}</span>
                              </button>
                            </div>
                          )}

                          <div className="p-3 rounded-xl bg-[#0B1220] border border-[#22324C] text-[11px] text-[#94A3B8] space-y-1">
                            <strong className="text-white block">Privacidad garantizada</strong>
                            <p>No se guardan conversaciones, contactos ni documentos personales en este teléfono móvil.</p>
                          </div>

                          {deviceIdentity && (
                            <div className="rounded-xl bg-[#0B1220] border border-[#22324C] overflow-hidden">
                              <button
                                type="button"
                                onClick={() => setShowSetupAdvancedTech((prev) => !prev)}
                                className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-[#94A3B8] hover:text-white cursor-pointer"
                              >
                                <span>Información técnica avanzada</span>
                                {showSetupAdvancedTech ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                              {showSetupAdvancedTech && (
                                <div className="px-3 pb-2.5 pt-1 border-t border-[#22324C] space-y-1 font-mono text-[10px] text-[#94A3B8]">
                                  <div className="flex justify-between gap-2">
                                    <span>ID asignado:</span>
                                    <strong className="text-white truncate">{deviceIdentity.deviceId}</strong>
                                  </div>
                                  <div className="flex justify-between gap-2">
                                    <span>Huella SHA-256:</span>
                                    <span className="text-[#10B981]">{deviceIdentity.fingerprint.slice(0, 17)}...</span>
                                  </div>
                                  <div className="flex justify-between gap-2">
                                    <span>Estado técnico:</span>
                                    <span className="text-white">{deviceIdentity.registrationStatus}</span>
                                  </div>
                                  {setupError && (
                                    <p className="text-[10px] text-[#F59E0B] pt-1 font-sans">{setupError}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {deviceIdentity && deviceIdentity.role === 'CORE' ? (
                      <button
                        type="button"
                        onClick={() => navigateTo('CORE_HOME')}
                        className="w-full h-11 rounded-xl bg-[#00CFE8] hover:bg-[#00b8ce] text-[#0B1220] font-extrabold text-xs cursor-pointer"
                      >
                        IR A MI PANEL VEL CORE
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isSettingUpDevice || !deviceIdentity}
                        onClick={() => navigateTo('TERMINAL_HOME')}
                        className="w-full h-11 rounded-xl bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-extrabold text-xs cursor-pointer disabled:opacity-50"
                      >
                        {isSettingUpDevice ? 'CONFIGURANDO VEL MÓVIL...' : 'IR AL PANEL DE VEL MÓVIL'}
                      </button>
                    )}
                  </div>
                )}

                {/* ============================================== */}
                {/* 2. PANTALLA: PANEL PRINCIPAL VEL CORE */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'CORE_HOME' && deviceIdentity && (
                  <div className="flex-1 px-5 py-3.5 flex flex-col justify-between space-y-3 overflow-y-auto">
                    <div className="space-y-3">
                      {/* Navegación superior visible + Cabecera */}
                      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#22324C]">
                        <button
                          type="button"
                          onClick={goHome}
                          className="h-8 px-2.5 rounded-lg bg-[#111C2E] hover:bg-[#18263E] border border-[#22324C] text-[#00CFE8] hover:text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>VOLVER AL INICIO</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setRoleChangeConfirmInput('');
                            setRoleChangeError(null);
                            setShowRoleChangeModal(true);
                          }}
                          className="h-8 px-2.5 rounded-lg bg-[#111C2E] border border-[#22324C] text-[#94A3B8] hover:text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          title="Cambiar la función de este teléfono"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Cambiar rol</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={goHome}
                          className="w-9 h-9 rounded-xl bg-[#00CFE8]/10 border border-[#00CFE8]/30 hover:border-[#00CFE8] flex items-center justify-center text-[#00CFE8] cursor-pointer transition-colors shrink-0"
                          title="Ir a la pantalla de bienvenida"
                          aria-label="Ir al inicio"
                        >
                          <Shield className="w-4 h-4" />
                        </button>
                        <div>
                          <h2 className="font-bold text-sm text-white leading-tight">Panel VEL CORE</h2>
                          <p className="text-[11px] text-[#94A3B8]">
                            Teléfono principal · Protección y administración
                          </p>
                        </div>
                      </div>

                      {/* 3 estados técnicos claros e independientes */}
                      {(() => {
                        const relaySimple = formatRelaySimpleStatus(relaySnapshot.connectionState);
                        const isConfirmedPaired = Boolean(
                          deviceIdentity.pairedPeerDeviceId &&
                            (deviceIdentity.registrationStatus === 'paired' ||
                              relaySnapshot.connectionState === 'LINKED')
                        );
                        const phoneStatusText = isConfirmedPaired
                          ? relaySnapshot.peerOnline
                            ? 'Emparejado · En línea'
                            : 'Emparejado · Desconectado'
                          : 'Pendiente de emparejamiento';
                        const phoneStatusCls = isConfirmedPaired
                          ? relaySnapshot.peerOnline
                            ? 'text-[#10B981]'
                            : 'text-[#00CFE8]'
                          : 'text-[#F59E0B]';

                        return (
                          <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#22324C]/70">
                              <span className="text-[#94A3B8] text-[11px]">Identidad CORE</span>
                              <span className={`font-bold text-[11px] ${registrationBadge.cls}`}>
                                {registrationBadge.label}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#22324C]/70">
                              <span className="text-[#94A3B8] text-[11px]">Servicio de comunicación</span>
                              <div className="flex items-center gap-2">
                                <span className={`font-bold text-[11px] ${relaySimple.cls}`}>
                                  {relaySimple.label}
                                </span>
                                {(relaySnapshot.connectionState === 'DISCONNECTED' ||
                                  relaySnapshot.connectionState === 'ERROR') &&
                                  deviceIdentity.registrationStatus !== 'revoked' && (
                                    <button
                                      type="button"
                                      onClick={handleReconnectRelay}
                                      className="text-[10px] font-bold text-[#00CFE8] hover:underline cursor-pointer"
                                    >
                                      Reconectar
                                    </button>
                                  )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[#94A3B8] text-[11px]">Teléfono MÓVIL</span>
                              <span className={`font-bold text-[11px] ${phoneStatusCls}`}>
                                {phoneStatusText}
                              </span>
                            </div>

                            {deviceIdentity.registrationStatus === 'pending_local' && (
                              <div className="pt-1 space-y-2">
                                <button
                                  type="button"
                                  onClick={handleRetryServerRegistration}
                                  disabled={isRetryingSync}
                                  className="w-full h-9 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-[#0B1220] font-bold text-[11px] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                                >
                                  {isRetryingSync && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                  <span>
                                    {isRetryingSync ? 'Registrando en la nube...' : 'Completar registro en la nube'}
                                  </span>
                                </button>

                                {(registrationFeedback?.type === 'error' || setupError || deviceIdentity.lastServerError) && (
                                  <div className="p-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/35 text-[11px] text-[#FCA5A5] space-y-1">
                                    <div className="flex items-center gap-1.5 font-bold text-[#EF4444]">
                                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                      <span>No se pudo completar el registro</span>
                                    </div>
                                    <p className="leading-snug break-words">
                                      {registrationFeedback?.type === 'error'
                                        ? registrationFeedback.message
                                        : setupError || deviceIdentity.lastServerError}
                                    </p>
                                    {(requiresExternalConfig || registrationFeedback?.requiresConfig) && (
                                      <p className="text-[10px] text-[#F59E0B] leading-snug pt-0.5">
                                        Verifica en Firebase Console que Anonymous Authentication esté habilitado y en Netlify que FIREBASE_SERVICE_ACCOUNT y las Netlify Functions (/api/*) estén activas.
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {deviceIdentity.registrationStatus !== 'pending_local' &&
                              deviceIdentity.registrationStatus !== 'revoked' &&
                              registrationFeedback?.type === 'success' && (
                                <div className="pt-1">
                                  <div className="p-2.5 rounded-xl bg-[#10B981]/10 border border-[#10B981]/35 text-[11px] text-[#10B981] space-y-2">
                                    <div className="flex items-center gap-1.5 font-bold">
                                      <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                                      <span>{registrationFeedback.message}</span>
                                    </div>
                                    {!deviceIdentity.pairedPeerDeviceId && (
                                      <button
                                        type="button"
                                        onClick={() => navigateTo('PAIRING_CORE')}
                                        className="w-full h-8 rounded-lg bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-extrabold text-[11px] cursor-pointer"
                                      >
                                        Continuar a vinculación VEL MÓVIL
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                          </div>
                        );
                      })()}

                      {/* Gestión de teléfono móvil */}
                      <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2.5">
                        <span className="text-xs font-bold text-white block">
                          Gestión de tu teléfono móvil
                        </span>

                        {!deviceIdentity.pairedPeerDeviceId && (
                          <p className="text-[11px] text-[#94A3B8] leading-snug">
                            Genera un código de invitación temporal de 8 caracteres en «Vincular» y escríbelo en tu VEL MÓVIL; luego ambos mostrarán un código SAS de 6 dígitos para confirmar cara a cara.
                          </p>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => navigateTo('PAIRING_CORE')}
                            className="h-9 rounded-xl bg-[#18263E] hover:bg-[#22324C] border border-[#22324C] text-[#00CFE8] font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>VINCULAR</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => navigateTo('DEVICE_MANAGEMENT')}
                            className="h-9 rounded-xl bg-[#18263E] hover:bg-[#22324C] border border-[#22324C] text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Smartphone className="w-3.5 h-3.5 text-[#00CFE8]" />
                            <span>ADMINISTRAR</span>
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => navigateTo('REPLACE_PHONE')}
                          className="w-full h-9 rounded-xl bg-[#0B1220] hover:bg-[#18263E] border border-[#00CFE8]/40 text-[#00CFE8] font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>REEMPLAZAR TELÉFONO MÓVIL</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setPublicUrlCopyStatus('idle');
                            navigateTo('SECOND_PHONE_GUIDE');
                          }}
                          className="w-full h-9 rounded-xl bg-[#0B1220] hover:bg-[#18263E] border border-[#10B981]/40 text-[#10B981] font-bold text-[11px] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Smartphone className="w-3.5 h-3.5 shrink-0" />
                          <span>CONFIGURAR VEL MÓVIL EN OTRO TELÉFONO</span>
                        </button>
                      </div>

                      {/* Comunicación protegida con el teléfono móvil (cuando está vinculado) */}
                      {deviceIdentity.pairedPeerDeviceId && (
                        <div className="p-3 rounded-2xl bg-[#111C2E] border border-[#00CFE8]/25 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                              <Lock className="w-3.5 h-3.5 text-[#00CFE8]" />
                              <span>Comunicación con tu teléfono móvil</span>
                            </span>
                            {relaySnapshot.connectionState !== 'LINKED' && (
                              <button
                                type="button"
                                onClick={handleReconnectRelay}
                                className="text-[10px] text-[#00CFE8] hover:underline cursor-pointer font-semibold"
                              >
                                Reconectar
                              </button>
                            )}
                          </div>

                          <form
                            onSubmit={(e) => void handleSendE2eeVerification(e)}
                            noValidate
                            className="flex gap-1.5"
                          >
                            <input
                              type="text"
                              value={e2eeMessageInput}
                              onChange={(e) => {
                                setE2eeMessageInput(e.target.value);
                                if (e2eeNotice) setE2eeNotice(null);
                              }}
                              placeholder="Escribe un mensaje protegido (obligatorio)..."
                              className="flex-1 h-8 px-2.5 rounded-lg bg-[#0B1220] border border-[#22324C] text-[11px] text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#00CFE8]"
                            />
                            <button
                              type="submit"
                              disabled={isSendingE2ee}
                              className="h-8 px-3 rounded-lg bg-[#00CFE8] hover:bg-[#00b8ce] text-[#0B1220] font-bold text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-45 shrink-0"
                            >
                              <Send className="w-3 h-3" />
                              <span>Enviar</span>
                            </button>
                          </form>

                          {e2eeNotice && (
                            <p className="text-[10px] text-[#F59E0B] leading-tight">{e2eeNotice}</p>
                          )}

                          {relaySnapshot.operations.slice(0, 2).map((op) => {
                            const st = formatOpStatusLabel(op.status);
                            return (
                              <div
                                key={op.operationId}
                                className="p-2 rounded-lg bg-[#0B1220] border border-[#22324C] text-[10px] space-y-0.5"
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-white truncate">{op.previewLabel}</span>
                                  <span className={`font-bold shrink-0 ${st.cls}`}>{st.text}</span>
                                </div>
                                <div className="flex items-center justify-between text-[#94A3B8]">
                                  <span className="truncate">{op.statusDetail}</span>
                                  {(op.status === 'FAILED' || op.status === 'UNKNOWN') &&
                                    op.direction === 'OUTGOING' && (
                                      <button
                                        type="button"
                                        onClick={() => void handleSendE2eeVerification(undefined, op.previewLabel)}
                                        className="text-[#00CFE8] font-bold ml-1 shrink-0 cursor-pointer"
                                      >
                                        Reintentar
                                      </button>
                                    )}
                                </div>
                              </div>
                            );
                          })}

                          {relaySnapshot.receivedMessages.length > 0 && (
                            <div className="p-2 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[10px] space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[#10B981] font-bold">
                                  Mensajes recientes en memoria ({relaySnapshot.receivedMessages.length}):
                                </span>
                                <button
                                  type="button"
                                  onClick={() => relayClientRef.current?.clearReceivedMessages()}
                                  className="text-[10px] text-[#00CFE8] hover:underline font-semibold cursor-pointer shrink-0"
                                >
                                  Limpiar
                                </button>
                              </div>
                              <div className="max-h-32 overflow-y-auto space-y-1.5">
                                {relaySnapshot.receivedMessages.map((msg) => (
                                  <div
                                    key={msg.operationId}
                                    className="p-1.5 rounded bg-[#0B1220] border border-[#22324C] space-y-1"
                                  >
                                    <span className="text-white break-words block">{msg.text}</span>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[9px] text-[#94A3B8]">
                                        {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleArchiveIncomingMessageInCore(msg.text, msg.operationId)
                                        }
                                        className="px-2 py-0.5 rounded bg-[#00CFE8]/15 border border-[#00CFE8]/40 text-[#00CFE8] font-bold cursor-pointer"
                                      >
                                        Guardar en bóveda CORE
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Bóveda Local Cifrada (Custodia exclusiva de VEL CORE) */}
                      <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#00CFE8]/30 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Database className="w-3.5 h-3.5 text-[#00CFE8]" />
                            <span>Bóveda Local Cifrada (CORE)</span>
                          </span>
                          <span className="text-[10px] text-[#00CFE8] font-bold">
                            {coreVaultRecords.length} registro{coreVaultRecords.length === 1 ? '' : 's'}
                          </span>
                        </div>

                        <form onSubmit={handleSaveCoreVaultNote} noValidate className="space-y-1.5">
                          <input
                            type="text"
                            value={vaultNoteTitle}
                            onChange={(e) => setVaultNoteTitle(e.target.value)}
                            placeholder="Título (opcional)"
                            className="w-full h-8 px-2.5 rounded-lg bg-[#0B1220] border border-[#22324C] text-[11px] text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#00CFE8]"
                          />
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={vaultNoteBody}
                              onChange={(e) => {
                                setVaultNoteBody(e.target.value);
                                if (vaultError) setVaultError(null);
                              }}
                              placeholder="Contenido a proteger (obligatorio)..."
                              className="flex-1 h-8 px-2.5 rounded-lg bg-[#0B1220] border border-[#22324C] text-[11px] text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#00CFE8]"
                            />
                            <button
                              type="submit"
                              disabled={isSavingVaultNote}
                              className="h-8 px-3 rounded-lg bg-[#00CFE8] hover:bg-[#00b8ce] text-[#0B1220] font-bold text-[11px] cursor-pointer disabled:opacity-50 shrink-0"
                            >
                              {isSavingVaultNote ? '...' : 'Guardar'}
                            </button>
                          </div>
                        </form>

                        {vaultError && (
                          <p className="text-[10px] text-[#EF4444] leading-snug">{vaultError}</p>
                        )}

                        {decryptedVaultNote && (
                          <div className="p-2.5 rounded-xl bg-[#0B1220] border border-[#10B981]/40 text-[11px] space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <strong className="text-[#10B981] truncate">{decryptedVaultNote.title}</strong>
                              <button
                                type="button"
                                onClick={() => setDecryptedVaultNote(null)}
                                className="text-[10px] text-[#94A3B8] hover:text-white inline-flex items-center gap-0.5 cursor-pointer shrink-0"
                              >
                                <EyeOff className="w-3 h-3" />
                                <span>Ocultar</span>
                              </button>
                            </div>
                            <p className="text-white break-words">{decryptedVaultNote.content}</p>
                          </div>
                        )}

                        {coreVaultRecords.length > 0 && (
                          <div className="max-h-24 overflow-y-auto space-y-1">
                            {coreVaultRecords.slice(0, 5).map((rec, idx) => (
                              <div
                                key={rec.id}
                                className="p-1.5 rounded-lg bg-[#0B1220] border border-[#22324C] flex items-center justify-between gap-2 text-[10px]"
                              >
                                <span className="text-[#94A3B8] truncate">
                                  Registro protegido #{coreVaultRecords.length - idx} · {new Date(rec.updatedAt).toLocaleDateString()}
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => void handleOpenCoreVaultNote(rec.id)}
                                    className="text-[#00CFE8] hover:underline inline-flex items-center gap-0.5 cursor-pointer font-semibold"
                                  >
                                    <Eye className="w-3 h-3" />
                                    <span>Ver</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteCoreVaultNote(rec.id)}
                                    className="text-[#EF4444] hover:underline inline-flex items-center cursor-pointer"
                                    title="Eliminar registro"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <p className="text-[10px] text-[#94A3B8] leading-snug">
                          Tu información se guarda protegida únicamente en este teléfono principal.
                        </p>
                      </div>

                      {fileTransferService && (
                        <CoreBinaryVaultPanel
                          transferService={fileTransferService}
                          incomingTransfers={fileTransferSnapshot.incoming}
                          vaultRevision={coreBinaryVaultRevision}
                        />
                      )}

                      {/* SECCIÓN DESTACADA: EMERGENCIA Y REVOCACIÓN */}
                      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-[#1A1A2E] to-[#161226] border border-[#EF4444]/40 space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="w-7 h-7 rounded-lg bg-[#EF4444]/15 border border-[#EF4444]/30 flex items-center justify-center text-[#EF4444] shrink-0 mt-0.5">
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white leading-tight">¿PERDISTE TU TELÉFONO O TE LO ROBARON?</h4>
                            <p className="text-[10px] text-[#94A3B8] leading-tight mt-0.5">
                              Inicia el procedimiento de emergencia ante pérdida o robo.
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setRevokeFeedback(null);
                            setShowEmergencyModal(true);
                          }}
                          className="w-full h-10 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg active:scale-[0.98]"
                        >
                          <AlertTriangle className="w-4 h-4" />
                          <span>EMERGENCIA Y REVOCACIÓN</span>
                        </button>
                      </div>

                      {/* Apartado colapsable de información técnica avanzada */}
                      <div className="rounded-xl bg-[#0B1220] border border-[#22324C] overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowCoreAdvancedTech((prev) => !prev)}
                          className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-[#94A3B8] hover:text-white cursor-pointer"
                        >
                          <span>Información técnica avanzada</span>
                          {showCoreAdvancedTech ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {showCoreAdvancedTech && (
                          <div className="px-3 pb-3 pt-1.5 border-t border-[#22324C] space-y-1 font-mono text-[10px] text-[#94A3B8]">
                            <div className="flex justify-between gap-2">
                              <span>ID dispositivo:</span>
                              <span className="text-white truncate">{deviceIdentity.deviceId}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span>Huella SHA-256:</span>
                              <span className="text-[#00CFE8]">{deviceIdentity.fingerprint.slice(0, 17)}...</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span>Claves privadas:</span>
                              <span className="text-[#10B981]">No exportables (Web Crypto)</span>
                            </div>
                            {deviceIdentity.firebaseAuthUid && (
                              <div className="flex justify-between gap-2">
                                <span>Firebase UID:</span>
                                <span className="text-white">{deviceIdentity.firebaseAuthUid.slice(0, 12)}...</span>
                              </div>
                            )}
                            {deviceIdentity.pairedPeerDeviceId && (
                              <div className="flex justify-between gap-2">
                                <span>MÓVIL vinculado:</span>
                                <span className="text-white truncate">{deviceIdentity.pairedPeerDeviceId}</span>
                              </div>
                            )}
                            {deviceIdentity.activeLinkId && (
                              <div className="flex justify-between gap-2">
                                <span>Vínculo ID:</span>
                                <span className="text-white truncate">{deviceIdentity.activeLinkId}</span>
                              </div>
                            )}
                            <p className="font-sans text-[10px] text-[#94A3B8] pt-1">
                              Bóveda cifrada con AES-256-GCM en IndexedDB local. Estado comercial independiente del resguardo local.
                            </p>
                            {setupError && <p className="font-sans text-[10px] text-[#F59E0B]">{setupError}</p>}
                            {relaySnapshot.lastError && (
                              <p className="font-sans text-[10px] text-[#EF4444]">{relaySnapshot.lastError}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-center pt-1 border-t border-[#22324C]">
                      <a
                        href={OFFICIAL_CONTRACT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[#94A3B8] hover:text-[#00CFE8] inline-flex items-center gap-1"
                      >
                        <FileText className="w-3 h-3" />
                        <span>Consultar términos y condiciones</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                )}

                {/* ============================================== */}
                {/* 4. PANTALLA: PANEL VEL MÓVIL */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'TERMINAL_HOME' && deviceIdentity && (
                  <div className="flex-1 px-5 py-3.5 flex flex-col justify-between space-y-3 overflow-y-auto">
                    <div className="space-y-3">
                      {/* Navegación superior visible */}
                      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#22324C]">
                        <button
                          type="button"
                          onClick={goHome}
                          className="h-8 px-2.5 rounded-lg bg-[#111C2E] hover:bg-[#18263E] border border-[#22324C] text-[#00CFE8] hover:text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>VOLVER AL INICIO</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setRoleChangeConfirmInput('');
                            setRoleChangeError(null);
                            setShowRoleChangeModal(true);
                          }}
                          className="h-8 px-2.5 rounded-lg bg-[#111C2E] border border-[#22324C] text-[#94A3B8] hover:text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          title="Cambiar la función de este teléfono"
                        >
                          <RefreshCw className="w-3 h-3" />
                          <span>Cambiar rol</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={goHome}
                          className="w-9 h-9 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 hover:border-[#10B981] flex items-center justify-center text-[#10B981] cursor-pointer transition-colors shrink-0"
                          title="Ir a la pantalla de bienvenida"
                          aria-label="Ir al inicio"
                        >
                          <Smartphone className="w-4 h-4" />
                        </button>
                        <div>
                          <h2 className="font-bold text-sm text-white leading-tight">Panel VEL MÓVIL</h2>
                          <p className="text-[11px] text-[#94A3B8]">
                            Teléfono de uso diario · Sin custodia de datos
                          </p>
                        </div>
                      </div>

                      {/* Estados claros y separados */}
                      {(() => {
                        const relaySimple = formatRelaySimpleStatus(relaySnapshot.connectionState);
                        const isConfirmedPaired = Boolean(
                          deviceIdentity.pairedPeerDeviceId &&
                            (deviceIdentity.registrationStatus === 'paired' ||
                              relaySnapshot.connectionState === 'LINKED')
                        );
                        const coreStatusText =
                          deviceIdentity.registrationStatus === 'revoked'
                            ? 'Acceso revocado por CORE'
                            : isConfirmedPaired
                            ? relaySnapshot.peerOnline
                              ? 'Emparejado · En línea'
                              : 'Emparejado · Desconectado'
                            : 'Pendiente de emparejamiento';
                        const coreStatusCls =
                          deviceIdentity.registrationStatus === 'revoked'
                            ? 'text-[#EF4444]'
                            : isConfirmedPaired
                            ? relaySnapshot.peerOnline
                              ? 'text-[#10B981]'
                              : 'text-[#00CFE8]'
                            : 'text-[#F59E0B]';

                        return (
                          <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2.5 text-xs">
                            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#22324C]/70">
                              <span className="text-[#94A3B8] text-[11px]">Identidad MÓVIL</span>
                              <span className={`font-bold text-[11px] ${registrationBadge.cls}`}>
                                {registrationBadge.label}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#22324C]/70">
                              <span className="text-[#94A3B8] text-[11px]">Servicio de comunicación</span>
                              <div className="flex items-center gap-2">
                                <span className={`font-bold text-[11px] ${relaySimple.cls}`}>
                                  {relaySimple.label}
                                </span>
                                {(relaySnapshot.connectionState === 'DISCONNECTED' ||
                                  relaySnapshot.connectionState === 'ERROR') &&
                                  deviceIdentity.registrationStatus !== 'revoked' && (
                                    <button
                                      type="button"
                                      onClick={handleReconnectRelay}
                                      className="text-[10px] font-bold text-[#00CFE8] hover:underline cursor-pointer"
                                    >
                                      Reconectar
                                    </button>
                                  )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[#94A3B8] text-[11px]">VEL CORE asociado</span>
                              <span className={`font-bold text-[11px] ${coreStatusCls}`}>
                                {coreStatusText}
                              </span>
                            </div>

                            {deviceIdentity.registrationStatus === 'revoked' && (
                              <div className="p-2.5 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#FCA5A5] text-[11px] leading-tight">
                                {relaySnapshot.lastRevocationMessage ||
                                  'Acceso revocado permanentemente por VEL CORE para este dispositivo.'}
                              </div>
                            )}

                            {deviceIdentity.registrationStatus === 'pending_local' && (
                              <div className="pt-1 space-y-2">
                                <button
                                  type="button"
                                  onClick={handleRetryServerRegistration}
                                  disabled={isRetryingSync}
                                  className="w-full h-9 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-[#0B1220] font-bold text-[11px] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                                >
                                  {isRetryingSync && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                  <span>
                                    {isRetryingSync ? 'Registrando en la nube...' : 'Completar registro en la nube'}
                                  </span>
                                </button>
                              </div>
                            )}

                            {deviceIdentity.registrationStatus !== 'pending_local' &&
                              deviceIdentity.registrationStatus !== 'revoked' &&
                              registrationFeedback?.type === 'success' && (
                                <div className="p-2.5 rounded-xl bg-[#10B981]/10 border border-[#10B981]/35 text-[11px] text-[#10B981] flex items-center gap-1.5 font-bold">
                                  <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                                  <span>{registrationFeedback.message}</span>
                                </div>
                              )}
                          </div>
                        );
                      })()}

                      {/* Emparejamiento desde VEL MÓVIL (visible tanto si falta registro remoto como si ya está registrado) */}
                      {!deviceIdentity.pairedPeerDeviceId &&
                        deviceIdentity.registrationStatus === 'pending_local' && (
                          <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#F59E0B]/40 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-[#F59E0B] text-xs font-bold">
                                <Radio className="w-4 h-4" />
                                <span>Vincular con VEL CORE</span>
                              </div>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30">
                                Registro pendiente
                              </span>
                            </div>
                            <p className="text-[11px] text-[#94A3B8] leading-snug">
                              Para poder emparejar este teléfono con tu VEL CORE, primero debe completarse el registro remoto de esta identidad en la nube. Tus claves locales ya están protegidas.
                            </p>
                            {(registrationFeedback?.type === 'error' || setupError || deviceIdentity.lastServerError) && (
                              <p className="text-[10px] text-[#FCA5A5] leading-snug bg-[#0B1220] p-2 rounded-lg border border-[#EF4444]/30 break-words">
                                {registrationFeedback?.type === 'error'
                                  ? registrationFeedback.message
                                  : setupError || deviceIdentity.lastServerError}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={handleRetryServerRegistration}
                              disabled={isRetryingSync}
                              className="w-full h-9 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-[#0B1220] font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                            >
                              {isRetryingSync && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              <span>{isRetryingSync ? 'Registrando en la nube...' : 'Completar registro para vincular'}</span>
                            </button>
                          </div>
                        )}

                      {!deviceIdentity.pairedPeerDeviceId &&
                        deviceIdentity.registrationStatus === 'registered' && (
                          <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#10B981]/30 space-y-2.5">
                            <div className="flex items-center gap-2 text-[#10B981] text-xs font-bold">
                              <Radio className="w-4 h-4" />
                              <span>Vincular con VEL CORE</span>
                            </div>

                            {relaySnapshot.pairingSession?.stage === 'CLAIMING' ? (
                              <div className="p-3.5 rounded-xl bg-[#0B1220] border border-[#00CFE8]/35 text-center space-y-2.5">
                                <Loader2 className="w-5 h-5 text-[#00CFE8] animate-spin mx-auto" />
                                <div className="space-y-1">
                                  <p className="text-xs font-bold text-white">
                                    Verificando código de invitación...
                                  </p>
                                  <p className="text-[11px] font-mono text-[#00CFE8] tracking-widest">
                                    {relaySnapshot.pairingSession.code}
                                  </p>
                                  <p className="text-[11px] text-[#94A3B8] leading-snug">
                                    Esperando confirmación de VEL CORE para mostrar el código SAS de 6 dígitos.
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => relayClientRef.current!.cancelPairing('CANCELLED_BY_TERMINAL')}
                                  className="w-full h-8 rounded-lg border border-[#EF4444]/40 text-[#EF4444] text-[10px] font-bold cursor-pointer"
                                >
                                  Cancelar espera
                                </button>
                              </div>
                            ) : relaySnapshot.pairingSession?.stage === 'SAS_PENDING' ||
                              relaySnapshot.pairingSession?.stage === 'SAS_AWAITING_PEER' ? (
                              <div className="space-y-2.5">
                                <div className="p-3 rounded-xl bg-[#0B1220] border border-[#10B981]/40 text-center space-y-1.5">
                                  <span className="text-[10px] font-bold text-[#10B981] uppercase tracking-wider block">
                                    Paso 2 · Código SAS de 6 dígitos
                                  </span>
                                  <div className="text-2xl font-mono font-extrabold tracking-[0.22em] text-[#10B981] py-1">
                                    {relaySnapshot.pairingSession.sasCode || '---'}
                                  </div>
                                </div>

                                {relaySnapshot.pairingSession.localConfirmedSas ||
                                relaySnapshot.pairingSession.stage === 'SAS_AWAITING_PEER' ? (
                                  <div className="space-y-2">
                                    <button
                                      type="button"
                                      disabled
                                      className="w-full h-10 rounded-xl bg-[#18263E] text-[#10B981] border border-[#10B981]/30 font-bold text-xs opacity-90 cursor-not-allowed"
                                    >
                                      ✓ Confirmado. Esperando a VEL CORE...
                                    </button>
                                    <p className="text-[10px] text-[#94A3B8] leading-snug text-center">
                                      Ambos teléfonos deben confirmar este código SAS de 6 dígitos para completar la vinculación.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => relayClientRef.current!.cancelPairing('CANCELLED_BY_TERMINAL')}
                                      className="w-full h-8 rounded-lg border border-[#EF4444]/40 text-[#EF4444] text-[10px] font-bold cursor-pointer"
                                    >
                                      Cancelar vinculación
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-[11px] text-[#94A3B8] leading-snug text-center">
                                      Compara este código SAS de 6 dígitos (verificación cara a cara) con el que aparece en tu VEL CORE. Pulsa confirmar solo si coinciden.
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                      <button
                                        type="button"
                                        onClick={() => relayClientRef.current!.cancelPairing('SAS_MISMATCH')}
                                        className="h-10 rounded-xl border border-[#EF4444]/50 text-[#EF4444] font-bold text-xs cursor-pointer"
                                      >
                                        No coincide
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          try {
                                            relayClientRef.current?.confirmPairingSas();
                                          } catch (err) {
                                            console.error('Error al confirmar SAS en Móvil:', err);
                                          }
                                        }}
                                        className="h-10 rounded-xl bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-extrabold text-xs cursor-pointer"
                                      >
                                        Confirmar SAS
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {relaySnapshot.lastError && (
                                  <div className="p-2.5 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-[11px] text-[#FCA5A5] leading-snug flex items-start gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444] shrink-0 mt-0.5" />
                                    <span>{relaySnapshot.lastError}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <form onSubmit={handleClaimPairingCode} noValidate className="space-y-2">
                                <p className="text-[11px] text-[#94A3B8] leading-snug">
                                  Paso 1: ingresa el <strong className="text-white">código de invitación de 8 caracteres</strong> (formato <span className="font-mono text-white">XXXX-XXXX</span>) generado en «Vincular» de tu VEL CORE (obligatorio):
                                </p>
                                <p className="text-[10px] text-[#94A3B8] leading-snug">
                                  Luego ambos teléfonos mostrarán un código SAS distinto de 6 dígitos para confirmar cara a cara.
                                </p>
                                <input
                                  type="text"
                                  value={pairingCodeInput}
                                  onChange={(e) => {
                                    setPairingCodeInput(e.target.value.toUpperCase());
                                    if (pairingFormError) setPairingFormError(null);
                                  }}
                                  placeholder="Ej: ABCD-2345"
                                  className="w-full h-9 px-3 rounded-xl bg-[#0B1220] border border-[#22324C] text-xs font-mono text-white text-center tracking-widest uppercase focus:outline-none focus:border-[#10B981]"
                                />
                                {(pairingFormError ||
                                  relaySnapshot.lastError ||
                                  relaySnapshot.pairingSession?.stage === 'EXPIRED') && (
                                  <div className="p-2.5 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-[11px] text-[#FCA5A5] leading-snug flex items-start gap-1.5">
                                    <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444] shrink-0 mt-0.5" />
                                    <span>
                                      {pairingFormError ||
                                        relaySnapshot.lastError ||
                                        'El código de invitación de 8 caracteres expiró. Genera uno nuevo en tu VEL CORE.'}
                                    </span>
                                  </div>
                                )}
                                <button
                                  type="submit"
                                  disabled={isClaimingPairing}
                                  className="w-full h-9 rounded-xl bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-bold text-xs cursor-pointer disabled:opacity-45"
                                >
                                  {isClaimingPairing ? 'Enviando código...' : 'Conectar con VEL CORE'}
                                </button>
                              </form>
                            )}
                          </div>
                        )}

                      {/* Comunicación con VEL CORE (cuando ya está vinculado) */}
                      {deviceIdentity.pairedPeerDeviceId &&
                        deviceIdentity.registrationStatus === 'paired' && (
                          <div className="p-3 rounded-2xl bg-[#111C2E] border border-[#00CFE8]/25 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                <Lock className="w-3.5 h-3.5 text-[#00CFE8]" />
                                <span>Comunicación con VEL CORE</span>
                              </span>
                              <span className="text-[10px] text-[#94A3B8]">
                                {relaySnapshot.peerOnline ? 'En línea' : 'Desconectado'}
                              </span>
                            </div>

                            <form
                              onSubmit={(e) => void handleSendE2eeVerification(e)}
                              noValidate
                              className="flex gap-1.5"
                            >
                              <input
                                type="text"
                                value={e2eeMessageInput}
                                onChange={(e) => {
                                  setE2eeMessageInput(e.target.value);
                                  if (e2eeNotice) setE2eeNotice(null);
                                }}
                                placeholder="Escribe un mensaje para CORE (obligatorio)..."
                                className="flex-1 h-8 px-2.5 rounded-lg bg-[#0B1220] border border-[#22324C] text-[11px] text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#00CFE8]"
                              />
                              <button
                                type="submit"
                                disabled={isSendingE2ee}
                                className="h-8 px-3 rounded-lg bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-bold text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-45 shrink-0"
                              >
                                <Send className="w-3 h-3" />
                                <span>Enviar</span>
                              </button>
                            </form>

                            {e2eeNotice && (
                              <p className="text-[10px] text-[#F59E0B] leading-tight">{e2eeNotice}</p>
                            )}

                            {relaySnapshot.operations.slice(0, 2).map((op) => {
                              const st = formatOpStatusLabel(op.status);
                              return (
                                <div
                                  key={op.operationId}
                                  className="p-2 rounded-lg bg-[#0B1220] border border-[#22324C] text-[10px] space-y-0.5"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="text-white truncate">{op.previewLabel}</span>
                                    <span className={`font-bold shrink-0 ${st.cls}`}>{st.text}</span>
                                  </div>
                                  <p className="text-[#94A3B8] truncate">{op.statusDetail}</p>
                                </div>
                              );
                            })}

                            {relaySnapshot.receivedMessages.length > 0 && (
                              <div className="p-2 rounded-lg bg-[#10B981]/10 border border-[#10B981]/25 text-[10px] space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[#10B981] font-bold">
                                    Recibidos solo en memoria ({relaySnapshot.receivedMessages.length}):
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => relayClientRef.current?.clearReceivedMessages()}
                                    className="text-[10px] text-[#00CFE8] hover:underline font-semibold cursor-pointer shrink-0"
                                  >
                                    Limpiar memoria
                                  </button>
                                </div>
                                <div className="max-h-36 overflow-y-auto space-y-1">
                                  {relaySnapshot.receivedMessages.map((msg) => (
                                    <div
                                      key={msg.operationId}
                                      className="p-1.5 rounded bg-[#0B1220] border border-[#22324C] space-y-0.5"
                                    >
                                      <span className="text-white break-words block">{msg.text}</span>
                                      {msg.timestamp ? (
                                        <span className="text-[9px] text-[#94A3B8] block">
                                          {new Date(msg.timestamp).toLocaleTimeString()}
                                        </span>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                      {/* Transferencia cifrada de archivos hacia VEL CORE */}
                      {fileTransferService && (
                        <MobileFileTransferPanel
                          transferService={fileTransferService}
                          snapshot={fileTransferSnapshot}
                          connectionState={relaySnapshot.connectionState}
                          peerOnline={relaySnapshot.peerOnline}
                          isRevoked={deviceIdentity.registrationStatus === 'revoked'}
                          isPaired={Boolean(
                            deviceIdentity.pairedPeerDeviceId &&
                              deviceIdentity.registrationStatus === 'paired'
                          )}
                        />
                      )}

                      {/* Garantía de uso */}
                      <div className="p-3 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-1">
                        <div className="flex items-center gap-2 text-white">
                          <Lock className="w-3.5 h-3.5 text-[#10B981]" />
                          <h4 className="text-xs font-bold">Sin almacenamiento personal en móvil</h4>
                        </div>
                        <p className="text-[11px] text-[#94A3B8] leading-snug">
                          Tu información personal permanece resguardada únicamente en tu teléfono principal VEL CORE.
                        </p>
                      </div>

                      {/* Apartado colapsable de información técnica avanzada */}
                      <div className="rounded-xl bg-[#0B1220] border border-[#22324C] overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowTerminalAdvancedTech((prev) => !prev)}
                          className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-[#94A3B8] hover:text-white cursor-pointer"
                        >
                          <span>Información técnica avanzada</span>
                          {showTerminalAdvancedTech ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {showTerminalAdvancedTech && (
                          <div className="px-3 pb-3 pt-1.5 border-t border-[#22324C] space-y-1.5 font-mono text-[10px] text-[#94A3B8]">
                            <div className="flex justify-between gap-2">
                              <span>ID dispositivo:</span>
                              <span className="text-white truncate">{deviceIdentity.deviceId}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span>Huella SHA-256:</span>
                              <span className="text-[#00CFE8]">{deviceIdentity.fingerprint.slice(0, 17)}...</span>
                            </div>
                            {deviceIdentity.pairedPeerDeviceId && (
                              <div className="flex justify-between gap-2">
                                <span>CORE asociado:</span>
                                <span className="text-white truncate">{deviceIdentity.pairedPeerDeviceId}</span>
                              </div>
                            )}
                            <div className="pt-1 flex justify-end">
                              <button
                                type="button"
                                onClick={handleRefreshDeviceSession}
                                disabled={isRetryingSync}
                                className="font-sans text-[11px] text-[#00CFE8] hover:underline cursor-pointer disabled:opacity-50"
                              >
                                {isRetryingSync ? 'Sincronizando...' : 'Sincronizar estado con servidor'}
                              </button>
                            </div>
                            {setupError && <p className="font-sans text-[10px] text-[#F59E0B]">{setupError}</p>}
                            {relaySnapshot.lastError && (
                              <p className="font-sans text-[10px] text-[#EF4444]">{relaySnapshot.lastError}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-center pt-1 border-t border-[#22324C]">
                      <a
                        href={OFFICIAL_CONTRACT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[#94A3B8] hover:text-[#00CFE8] inline-flex items-center gap-1"
                      >
                        <FileText className="w-3 h-3" />
                        <span>Consultar términos y condiciones</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                  </div>
                )}

                {/* ============================================== */}
                {/* 5. PANTALLA: VINCULAR TELÉFONO MÓVIL (CORE) */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'PAIRING_CORE' && deviceIdentity && (
                  <div className="flex-1 px-5 py-4 flex flex-col justify-between space-y-3 overflow-y-auto">
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => goBack('CORE_HOME')}
                        className="h-9 px-3 rounded-xl text-[#00CFE8] hover:text-white bg-[#111C2E] border border-[#22324C] inline-flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-sm"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>VOLVER</span>
                      </button>

                      <div className="space-y-0.5">
                        <h2 className="text-base font-bold text-white">Vincular teléfono móvil</h2>
                        <p className="text-xs text-[#94A3B8]">
                          Paso 1: genera un código de invitación temporal de 8 caracteres. Paso 2: confirma que el código SAS de 6 dígitos coincida en ambos teléfonos.
                        </p>
                      </div>

                      {deviceIdentity.registrationStatus === 'pending_local' && (
                        <div className="p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/35 text-[11px] text-[#F59E0B] space-y-2">
                          <p className="leading-snug">
                            <strong>Registro en la nube pendiente:</strong> primero completa el registro de VEL CORE para poder generar códigos de invitación.
                          </p>
                          {(registrationFeedback?.type === 'error' || setupError || deviceIdentity.lastServerError) && (
                            <div className="p-2 rounded-lg bg-[#0B1220] border border-[#EF4444]/35 text-[#FCA5A5] text-[10px] leading-snug space-y-1 break-words">
                              <p>
                                {registrationFeedback?.type === 'error'
                                  ? registrationFeedback.message
                                  : setupError || deviceIdentity.lastServerError}
                              </p>
                              {(requiresExternalConfig || registrationFeedback?.requiresConfig) && (
                                <p className="text-[#F59E0B]">
                                  Verifica Firebase Anonymous Authentication y la variable FIREBASE_SERVICE_ACCOUNT en Netlify.
                                </p>
                              )}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={handleRetryServerRegistration}
                            disabled={isRetryingSync}
                            className="w-full h-9 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-[#0B1220] font-bold text-[11px] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                          >
                            {isRetryingSync && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span>{isRetryingSync ? 'Registrando en la nube...' : 'Completar registro en la nube'}</span>
                          </button>
                        </div>
                      )}

                      {deviceIdentity.registrationStatus !== 'pending_local' &&
                        deviceIdentity.registrationStatus !== 'revoked' &&
                        registrationFeedback?.type === 'success' && (
                          <div className="p-2.5 rounded-xl bg-[#10B981]/10 border border-[#10B981]/35 text-[11px] text-[#10B981] flex items-center gap-1.5 font-bold">
                            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>{registrationFeedback.message}</span>
                          </div>
                        )}

                      {relaySnapshot.connectionState !== 'AUTHENTICATED' &&
                        relaySnapshot.connectionState !== 'LINKED' && (
                          <div className="p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[11px] text-[#F59E0B] flex items-center justify-between gap-2">
                            <span>Conectando con el servicio de comunicación...</span>
                            <button
                              type="button"
                              onClick={handleReconnectRelay}
                              className="px-2.5 py-1 rounded-lg bg-[#18263E] text-[#00CFE8] font-bold text-[10px] cursor-pointer shrink-0"
                            >
                              Reconectar
                            </button>
                          </div>
                        )}

                      {relaySnapshot.pairingSession?.stage === 'OFFERING' && (
                        <div className="p-4 rounded-2xl bg-[#111C2E] border border-[#00CFE8]/40 space-y-3 text-center">
                          <span className="text-[11px] text-[#94A3B8] font-bold block">
                            Paso 1 · Código de invitación de 8 caracteres (válido 5 minutos)
                          </span>
                          <div className="text-2xl font-mono font-extrabold text-[#00CFE8] tracking-widest bg-[#0B1220] py-2.5 rounded-xl border border-[#22324C]">
                            {relaySnapshot.pairingSession.code}
                          </div>
                          <div className="flex items-center justify-center gap-3 text-[11px] text-[#94A3B8]">
                            <span>
                              Expira en:{' '}
                              <strong className="text-white font-mono">
                                {Math.floor(pairingCountdownSec / 60)}:
                                {String(pairingCountdownSec % 60).padStart(2, '0')}
                              </strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard?.writeText(relaySnapshot.pairingSession!.code);
                                setCopiedPairingCode(true);
                                setTimeout(() => setCopiedPairingCode(false), 1800);
                              }}
                              className="text-[#00CFE8] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" />
                              <span>{copiedPairingCode ? 'Copiado' : 'Copiar'}</span>
                            </button>
                          </div>
                          <p className="text-[11px] text-[#94A3B8] leading-snug">
                            Escribe este código de 8 caracteres (formato <span className="font-mono text-white">XXXX-XXXX</span>) en tu VEL MÓVIL. Después ambos mostrarán un código SAS distinto de 6 dígitos para verificar cara a cara.
                          </p>
                          <button
                            type="button"
                            onClick={() => relayClientRef.current!.cancelPairing()}
                            className="w-full h-8 rounded-lg border border-[#EF4444]/40 text-[#EF4444] text-[11px] font-bold cursor-pointer"
                          >
                            Cancelar código
                          </button>
                        </div>
                      )}

                      {(relaySnapshot.pairingSession?.stage === 'SAS_PENDING' ||
                        relaySnapshot.pairingSession?.stage === 'SAS_AWAITING_PEER') && (
                        <div className="p-4 rounded-2xl bg-[#111C2E] border-2 border-[#00CFE8] space-y-3">
                          <div className="text-center space-y-1">
                            <span className="text-[11px] font-bold text-[#00CFE8] uppercase tracking-wider block">
                              Paso 2 · Código SAS de 6 dígitos (verificación cara a cara)
                            </span>
                            <div className="text-3xl font-mono font-extrabold tracking-[0.22em] text-white py-2 bg-[#0B1220] rounded-xl border border-[#22324C]">
                              {relaySnapshot.pairingSession.sasCode}
                            </div>
                          </div>

                          {relaySnapshot.pairingSession.localConfirmedSas ? (
                            <div className="space-y-2">
                              <div className="p-2.5 rounded-xl bg-[#00CFE8]/10 border border-[#00CFE8]/30 text-[11px] text-[#00CFE8] text-center">
                                ✓ Confirmado en VEL CORE. Ahora pulsa «Confirmar SAS» en tu VEL MÓVIL.
                              </div>
                              <button
                                type="button"
                                onClick={() => relayClientRef.current!.cancelPairing('CANCELLED_BY_CORE')}
                                className="w-full h-9 rounded-xl border border-[#EF4444]/50 text-[#EF4444] font-bold text-xs cursor-pointer"
                              >
                                Cancelar vinculación
                              </button>
                            </div>
                          ) : (
                            <>
                              <p className="text-[11px] text-[#94A3B8] leading-snug text-center">
                                Confirma únicamente si este código SAS de 6 dígitos coincide en ambos teléfonos.
                              </p>

                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => relayClientRef.current!.cancelPairing('SAS_MISMATCH')}
                                  className="h-10 rounded-xl border border-[#EF4444]/50 text-[#EF4444] font-bold text-xs cursor-pointer"
                                >
                                  No coincide
                                </button>
                                <button
                                  type="button"
                                  onClick={() => relayClientRef.current!.confirmPairingSas()}
                                  className="h-10 rounded-xl bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-extrabold text-xs cursor-pointer"
                                >
                                  Confirmar SAS
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {relaySnapshot.pairingSession?.stage === 'CONFIRMED' && (
                        <div className="p-4 rounded-2xl bg-[#10B981]/10 border border-[#10B981]/40 space-y-2 text-center">
                          <CheckCircle className="w-8 h-8 text-[#10B981] mx-auto" />
                          <h3 className="text-xs font-bold text-white">Teléfono móvil vinculado</h3>
                          <p className="text-[11px] text-[#94A3B8]">
                            Ambos teléfonos quedaron autorizados y protegidos de extremo a extremo.
                          </p>
                        </div>
                      )}

                      {(!relaySnapshot.pairingSession ||
                        relaySnapshot.pairingSession.stage === 'CANCELLED' ||
                        relaySnapshot.pairingSession.stage === 'EXPIRED') && (
                        <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-3">
                          <button
                            type="button"
                            onClick={handleCreatePairingOffer}
                            disabled={
                              deviceIdentity.registrationStatus === 'pending_local' ||
                              isStartingPairingOffer ||
                              (relaySnapshot.connectionState !== 'AUTHENTICATED' &&
                                relaySnapshot.connectionState !== 'LINKED')
                            }
                            className="w-full h-11 rounded-xl bg-[#00CFE8] hover:bg-[#00b8ce] text-[#0B1220] font-extrabold text-xs cursor-pointer disabled:opacity-45"
                          >
                            {isStartingPairingOffer ? 'Generando código...' : 'Generar código de emparejamiento'}
                          </button>
                          <p className="text-[11px] text-[#94A3B8] text-center leading-snug">
                            El código caduca automáticamente después de 5 minutos por seguridad.
                          </p>
                        </div>
                      )}

                      <div className="rounded-xl bg-[#0B1220] border border-[#22324C] overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowPairingAdvancedTech((prev) => !prev)}
                          className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-[#94A3B8] hover:text-white cursor-pointer"
                        >
                          <span>Información técnica avanzada</span>
                          {showPairingAdvancedTech ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {showPairingAdvancedTech && (
                          <div className="px-3 pb-2.5 pt-1 border-t border-[#22324C] space-y-1 font-mono text-[10px] text-[#94A3B8]">
                            <div className="flex justify-between gap-2">
                              <span>ID VEL CORE:</span>
                              <span className="text-white truncate">{deviceIdentity.deviceId}</span>
                            </div>
                            <div>
                              <span className="block">Huella SHA-256:</span>
                              <span className="text-[#00CFE8] break-all">{deviceIdentity.fingerprint}</span>
                            </div>
                            {relaySnapshot.pairingSession?.peerDeviceId && (
                              <div className="flex justify-between gap-2 pt-1">
                                <span>MÓVIL par:</span>
                                <span className="text-white truncate">{relaySnapshot.pairingSession.peerDeviceId}</span>
                              </div>
                            )}
                            {relaySnapshot.pairingSession?.peerFingerprint && (
                              <div className="flex justify-between gap-2">
                                <span>Huella par:</span>
                                <span className="text-[#00CFE8]">{relaySnapshot.pairingSession.peerFingerprint.slice(0, 17)}...</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {relaySnapshot.lastError && (
                        <p className="text-[10px] text-[#EF4444] text-center">{relaySnapshot.lastError}</p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => goBack('CORE_HOME')}
                      className="w-full h-10 rounded-xl bg-[#18263E] hover:bg-[#22324C] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>VOLVER</span>
                    </button>
                  </div>
                )}

                {/* ============================================== */}
                {/* 6. PANTALLA: ADMINISTRAR DISPOSITIVOS */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'DEVICE_MANAGEMENT' && deviceIdentity && (
                  <div className="flex-1 px-5 py-4 flex flex-col justify-between space-y-3 overflow-y-auto">
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => {
                          setRevokeFeedback(null);
                          goBack('CORE_HOME');
                        }}
                        className="h-9 px-3 rounded-xl text-[#00CFE8] hover:text-white bg-[#111C2E] border border-[#22324C] inline-flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-sm"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>VOLVER</span>
                      </button>

                      <div className="space-y-0.5">
                        <h2 className="text-base font-bold text-white">Administración de dispositivos</h2>
                        <p className="text-xs text-[#94A3B8]">
                          Controla qué teléfono móvil tiene permiso para conectarse con tu VEL CORE.
                        </p>
                      </div>

                      {deviceIdentity.pairedPeerDeviceId ? (
                        <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Smartphone className="w-4 h-4 text-[#00CFE8]" />
                              <span className="text-xs font-bold text-white">
                                Teléfono móvil vinculado
                              </span>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#10B981]/15 text-[#10B981]">
                              Autorizado
                            </span>
                          </div>
                          <p className="text-[11px] text-[#94A3B8] leading-snug">
                            Si ya no usas este teléfono, puedes retirar su autorización de inmediato.
                          </p>
                          <button
                            type="button"
                            onClick={() => void handleRevokePeerDevice('Revocado desde Administración de VEL CORE')}
                            disabled={isRevokingPeer}
                            className="w-full h-9 rounded-xl bg-[#EF4444]/15 hover:bg-[#EF4444]/25 border border-[#EF4444]/40 text-[#EF4444] font-bold text-xs cursor-pointer disabled:opacity-50"
                          >
                            {isRevokingPeer ? 'Revocando...' : 'Revocar autorización de este móvil'}
                          </button>
                        </div>
                      ) : (
                        <div className="p-4 rounded-2xl bg-[#111C2E] border border-[#22324C] text-center space-y-1.5">
                          <p className="text-xs font-bold text-white">Sin teléfono móvil vinculado</p>
                          <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                            Actualmente no hay ningún teléfono móvil autorizado en este VEL CORE.
                          </p>
                        </div>
                      )}

                      {revokeFeedback && (
                        <div className="p-2.5 rounded-xl bg-[#0B1220] border border-[#22324C] space-y-1 text-[11px]">
                          {(() => {
                            const rb = formatRevocationBadge(relaySnapshot.revocationStatus);
                            return rb ? (
                              <span className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded border ${rb.cls}`}>
                                {rb.label}
                              </span>
                            ) : null;
                          })()}
                          <p className="text-[#E2E8F0] leading-snug">{revokeFeedback}</p>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => navigateTo('REPLACE_PHONE')}
                        className="w-full h-10 rounded-xl bg-[#18263E] hover:bg-[#22324C] border border-[#00CFE8]/30 text-[#00CFE8] font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Reemplazar teléfono perdido o nuevo</span>
                      </button>

                      <div className="rounded-xl bg-[#0B1220] border border-[#22324C] overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowManageAdvancedTech((prev) => !prev)}
                          className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-[#94A3B8] hover:text-white cursor-pointer"
                        >
                          <span>Información técnica avanzada</span>
                          {showManageAdvancedTech ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {showManageAdvancedTech && (
                          <div className="px-3 pb-2.5 pt-1 border-t border-[#22324C] space-y-1 font-mono text-[10px] text-[#94A3B8]">
                            <div className="flex justify-between gap-2">
                              <span>ID VEL CORE:</span>
                              <span className="text-white truncate">{deviceIdentity.deviceId}</span>
                            </div>
                            {deviceIdentity.pairedPeerDeviceId && (
                              <div className="flex justify-between gap-2">
                                <span>ID MÓVIL par:</span>
                                <span className="text-white truncate">{deviceIdentity.pairedPeerDeviceId}</span>
                              </div>
                            )}
                            {deviceIdentity.activeLinkId && (
                              <div className="flex justify-between gap-2">
                                <span>Vínculo ID:</span>
                                <span className="text-[#00CFE8] truncate">{deviceIdentity.activeLinkId}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setRevokeFeedback(null);
                        goBack('CORE_HOME');
                      }}
                      className="w-full h-10 rounded-xl bg-[#18263E] hover:bg-[#22324C] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>VOLVER</span>
                    </button>
                  </div>
                )}

                {/* ============================================== */}
                {/* 7. PANTALLA: REEMPLAZAR TELÉFONO MÓVIL */}
                {/* ============================================== */}
                {!isLoadingIdentity && currentScreen === 'REPLACE_PHONE' && deviceIdentity && (
                  <div className="flex-1 px-5 py-4 flex flex-col justify-between space-y-3 overflow-y-auto">
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => {
                          setRevokeFeedback(null);
                          goBack('CORE_HOME');
                        }}
                        className="h-9 px-3 rounded-xl text-[#00CFE8] hover:text-white bg-[#111C2E] border border-[#22324C] inline-flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer shadow-sm"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>VOLVER</span>
                      </button>

                      <div className="space-y-0.5">
                        <h2 className="text-base font-bold text-white">Reemplazar teléfono móvil</h2>
                        <p className="text-xs text-[#94A3B8]">
                          Cambia tu teléfono diario manteniendo intactos tus datos e identidad de VEL CORE.
                        </p>
                      </div>

                      <div className="p-3 rounded-2xl bg-[#0B1220] border border-[#22324C] space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-white flex items-center gap-1.5">
                            <Shield className="w-3.5 h-3.5 text-[#00CFE8]" />
                            <span>Custodio: VEL CORE</span>
                          </span>
                          <span className="text-[10px] text-[#10B981] font-bold">
                            Datos protegidos
                          </span>
                        </div>
                        <p className="text-[11px] text-[#94A3B8]">
                          Tu información personal y claves principales permanecen intactas en este dispositivo.
                        </p>
                      </div>

                      <div className="p-3 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2">
                        <span className="text-xs font-bold text-white block">
                          Paso 1: Retirar acceso al teléfono anterior
                        </span>
                        {deviceIdentity.pairedPeerDeviceId ? (
                          <>
                            <p className="text-[11px] text-[#94A3B8]">
                              Hay un teléfono móvil actualmente vinculado. Revoca su permiso antes de asociar el nuevo.
                            </p>
                            <button
                              type="button"
                              onClick={() => void handleRevokePeerDevice('Reemplazo de teléfono móvil desde VEL CORE')}
                              disabled={isRevokingPeer}
                              className="w-full h-9 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] text-white font-bold text-xs cursor-pointer disabled:opacity-50"
                            >
                              {isRevokingPeer ? 'Revocando teléfono anterior...' : 'Revocar teléfono anterior ahora'}
                            </button>
                          </>
                        ) : (
                          <div className="text-[11px] text-[#10B981] p-2 rounded-xl bg-[#10B981]/10 border border-[#10B981]/25">
                            ✓ Sin teléfono móvil activo vinculado. Listo para vincular el nuevo.
                          </div>
                        )}
                      </div>

                      {revokeFeedback && (
                        <div className="p-2.5 rounded-xl bg-[#0B1220] border border-[#00CFE8]/30 text-[11px] text-[#00CFE8]">
                          {revokeFeedback}
                        </div>
                      )}

                      {(() => {
                        const revBadge = formatRevocationBadge(relaySnapshot.revocationStatus);
                        return (
                          <>
                            {revBadge && (
                              <div className="p-2.5 rounded-xl bg-[#0B1220] border border-[#22324C] space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-bold text-white">Estado de revocación</span>
                                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${revBadge.cls}`}>
                                    {revBadge.label}
                                  </span>
                                </div>
                                {relaySnapshot.revocationDetail && (
                                  <p className="text-[10px] text-[#94A3B8] leading-snug">
                                    {relaySnapshot.revocationDetail}
                                  </p>
                                )}
                              </div>
                            )}

                            <div className="p-3 rounded-2xl bg-[#111C2E] border border-[#22324C] space-y-2 text-[11px] text-[#94A3B8]">
                              <strong className="text-white text-xs block">Paso 2: Vincular nuevo VEL MÓVIL</strong>
                              <p className="leading-relaxed">
                                {deviceIdentity.pairedPeerDeviceId
                                  ? 'Primero completa el Paso 1 para retirar el permiso del teléfono anterior.'
                                  : 'Genera un código de invitación de 8 caracteres y confirma después el código SAS de 6 dígitos en ambos teléfonos.'}
                              </p>
                              <button
                                type="button"
                                disabled={Boolean(deviceIdentity.pairedPeerDeviceId)}
                                onClick={() => navigateTo('PAIRING_CORE')}
                                className="w-full h-9 rounded-xl bg-[#00CFE8] hover:bg-[#00b8ce] text-[#0B1220] font-bold text-xs cursor-pointer disabled:opacity-45"
                              >
                                Ir a vincular nuevo VEL MÓVIL
                              </button>
                            </div>
                          </>
                        );
                      })()}

                      <div className="p-3 rounded-xl bg-[#0B1220] border border-[#22324C] text-[11px] text-[#94A3B8] space-y-1">
                        <p>
                          <strong className="text-white">Sin costo adicional:</strong> El reemplazo no requiere una nueva contratación.
                        </p>
                        <p>
                          <strong className="text-white">Datos a salvo:</strong> Ninguna información guardada en VEL CORE se borra al cambiar tu móvil.
                        </p>
                      </div>

                      <div className="rounded-xl bg-[#0B1220] border border-[#22324C] overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowReplaceAdvancedTech((prev) => !prev)}
                          className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-semibold text-[#94A3B8] hover:text-white cursor-pointer"
                        >
                          <span>Información técnica avanzada</span>
                          {showReplaceAdvancedTech ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {showReplaceAdvancedTech && (
                          <div className="px-3 pb-2.5 pt-1 border-t border-[#22324C] space-y-1 font-mono text-[10px] text-[#94A3B8]">
                            <div className="flex justify-between gap-2">
                              <span>ID VEL CORE:</span>
                              <span className="text-white truncate">{deviceIdentity.deviceId}</span>
                            </div>
                            {deviceIdentity.pairedPeerDeviceId && (
                              <div className="flex justify-between gap-2">
                                <span>ID MÓVIL vinculado:</span>
                                <span className="text-white truncate">{deviceIdentity.pairedPeerDeviceId}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setRevokeFeedback(null);
                        goBack('CORE_HOME');
                      }}
                      className="w-full h-10 rounded-xl bg-[#18263E] hover:bg-[#22324C] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>VOLVER</span>
                    </button>
                  </div>
                )}

                {/* ============================================== */}
                {/* MODAL: CAMBIO CONTROLADO DE ROL */}
                {/* ============================================== */}
                {showRoleChangeModal && (
                  <div className="absolute inset-0 bg-black/85 backdrop-blur-sm p-4 flex items-center justify-center z-50">
                    <form
                      onSubmit={handleExecuteControlledRoleChange}
                      noValidate
                      className="bg-[#111C2E] border border-[#F59E0B]/50 rounded-2xl p-5 space-y-3 max-w-xs w-full shadow-2xl text-xs"
                    >
                      <div className="flex items-center gap-2 text-[#F59E0B]">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        <h3 className="font-bold text-sm text-white">Cambio controlado de rol</h3>
                      </div>

                      <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                        El rol de este teléfono se conserva entre sesiones. Si decides cambiarlo, la identidad actual se revocará y se preparará una nueva.
                      </p>

                      <div className="space-y-1">
                        <label className="text-[10px] text-[#94A3B8] block">
                          Escribe exactamente <strong className="text-white">{ROLE_CHANGE_CONFIRMATION_KEYWORD}</strong> para continuar (obligatorio):
                        </label>
                        <input
                          type="text"
                          value={roleChangeConfirmInput}
                          onChange={(e) => {
                            setRoleChangeConfirmInput(e.target.value);
                            if (roleChangeError) setRoleChangeError(null);
                          }}
                          placeholder={ROLE_CHANGE_CONFIRMATION_KEYWORD}
                          className="w-full h-9 px-3 bg-[#0B1220] border border-[#22324C] rounded-xl text-xs font-mono text-white focus:outline-none focus:border-[#F59E0B]"
                        />
                      </div>

                      {roleChangeError && (
                        <p className="text-[11px] text-[#EF4444] font-medium">{roleChangeError}</p>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          type="submit"
                          disabled={isChangingRole}
                          className="flex-1 h-9 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-[#0B1220] font-bold text-xs cursor-pointer disabled:opacity-60"
                        >
                          {isChangingRole ? 'Aplicando...' : 'Confirmar cambio'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowRoleChangeModal(false)}
                          className="flex-1 h-9 rounded-xl border border-[#22324C] text-[#94A3B8] text-xs cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* ============================================== */}
                {/* MODAL: PROCEDIMIENTO DE EMERGENCIA Y LOCALIZADOR */}
                {/* ============================================== */}
                {showEmergencyModal && (
                  <div className="absolute inset-0 bg-black/85 backdrop-blur-sm p-4 flex items-center justify-center z-50 overflow-y-auto">
                    <div className="bg-[#111C2E] border-2 border-[#EF4444] rounded-3xl p-5 space-y-3.5 max-w-xs w-full shadow-2xl text-xs">
                      <div className="flex items-center gap-2 text-[#EF4444]">
                        <AlertTriangle className="w-5 h-5 shrink-0" />
                        <h3 className="font-bold text-sm text-white">PROCEDIMIENTO DE EMERGENCIA</h3>
                      </div>

                      <p className="text-[#94A3B8] leading-relaxed">
                        Si perdiste tu teléfono móvil o sospechas que te lo robaron, sigue estos dos pasos claramente diferenciados:
                      </p>

                      {/* Acción 1: Revocación de VEL */}
                      <div className="p-3 rounded-xl bg-[#0B1220] border border-[#EF4444]/40 space-y-2">
                        <div className="flex items-center gap-1.5 text-white font-bold text-[11px]">
                          <span className="w-4 h-4 rounded-full bg-[#EF4444] text-white flex items-center justify-center text-[10px]">1</span>
                          <span>Revocar autorización de VEL:</span>
                        </div>
                        <p className="text-[10px] text-[#94A3B8] leading-tight">
                          {deviceIdentity?.pairedPeerDeviceId
                            ? `Dispositivo vinculado: ${deviceIdentity.pairedPeerDeviceId}. Esta acción invalida su autorización en Firestore y cierra su sesión en el Relay.`
                            : 'Actualmente no hay ningún VEL MÓVIL vinculado a este VEL CORE.'}
                        </p>
                        {deviceIdentity?.pairedPeerDeviceId && (
                          <button
                            type="button"
                            onClick={() => void handleRevokePeerDevice('Emergencia por pérdida o robo desde VEL CORE')}
                            disabled={isRevokingPeer}
                            className="w-full h-8 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white font-bold text-[11px] cursor-pointer disabled:opacity-50"
                          >
                            {isRevokingPeer ? 'Ejecutando revocación...' : 'REVOCAR VEL MÓVIL AHORA'}
                          </button>
                        )}
                        {revokeFeedback && (
                          <div className="space-y-1">
                            {(() => {
                              const rb = formatRevocationBadge(relaySnapshot.revocationStatus);
                              return rb ? (
                                <span className={`inline-block text-[9px] font-bold px-2 py-0.5 rounded border ${rb.cls}`}>
                                  {rb.label}
                                </span>
                              ) : null;
                            })()}
                            <p className="text-[10px] text-[#E2E8F0] leading-tight">{revokeFeedback}</p>
                          </div>
                        )}
                      </div>

                      {/* Acción 2: Google Localizador */}
                      <div className="p-3 rounded-xl bg-[#0B1220] border border-[#22324C] space-y-2">
                        <div className="flex items-center gap-1.5 text-white font-bold text-[11px]">
                          <span className="w-4 h-4 rounded-full bg-[#00CFE8] text-[#0B1220] flex items-center justify-center text-[10px] font-bold">2</span>
                          <span>Google Localizador (Encontrar mi dispositivo):</span>
                        </div>
                        <p className="text-[10px] text-[#94A3B8] leading-tight">
                          Permite localizar, bloquear o solicitar el borrado de fábrica de tu teléfono mediante tu cuenta de Google.
                        </p>

                        <div className="p-2 rounded bg-[#111C2E] border border-[#F59E0B]/30 text-[10px] text-[#F59E0B] leading-tight">
                          <strong>Aviso:</strong> Abrir Google Localizador no borra automáticamente el dispositivo: deberás iniciar sesión con tu cuenta de Google, seleccionar tu teléfono y solicitar la acción desde allí.
                        </div>

                        <a
                          href="https://android.com/find"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full h-8 rounded-lg bg-[#18263E] hover:bg-[#22324C] border border-[#00CFE8]/40 text-[#00CFE8] font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Abrir Google Localizador ↗</span>
                        </a>
                      </div>

                      <button
                        onClick={() => setShowEmergencyModal(false)}
                        className="w-full h-9 rounded-xl border border-[#22324C] text-[#94A3B8] text-xs hover:text-white cursor-pointer"
                      >
                        Cerrar ventana de emergencia
                      </button>
                    </div>
                  </div>
                )}

                {/* MODAL: INFORMACIÓN, AYUDA, DESINSTALACIÓN Y LIBERTAD DE CONTRATACIÓN (ⓘ) */}
                {showHelpModal && (
                  <div className="absolute inset-0 bg-black/85 backdrop-blur-sm p-4 flex items-center justify-center z-50 overflow-y-auto">
                    <div className="bg-[#111C2E] border border-[#22324C] rounded-3xl p-5 space-y-3.5 max-w-xs w-full shadow-2xl text-xs max-h-[720px] overflow-y-auto">
                      <div className="flex items-center justify-between pb-2 border-b border-[#22324C]">
                        <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                          <Info className="w-4 h-4 text-[#00CFE8]" />
                          <span>Información y Ayuda VEL</span>
                        </h3>
                        <button onClick={() => setShowHelpModal(false)} className="text-[#94A3B8] hover:text-white cursor-pointer">✕</button>
                      </div>

                      {/* 1. Información General */}
                      <div className="space-y-1 text-[#94A3B8]">
                        <h4 className="font-bold text-white text-[11px]">1. Arquitectura de dos teléfonos</h4>
                        <p className="text-[10px] leading-relaxed">
                          VEL opera separando funciones: VEL CORE es el custodio exclusivo de tus datos y claves. VEL MÓVIL es el terminal personal de acceso autorizado.
                        </p>
                      </div>

                      {/* 2. Instrucciones Básicas */}
                      <div className="space-y-1 text-[#94A3B8]">
                        <h4 className="font-bold text-white text-[11px]">2. Instrucciones de uso</h4>
                        <p className="text-[10px] leading-relaxed">
                          Configura primero VEL CORE en tu teléfono principal. Luego selecciona VEL MÓVIL en tu teléfono diario y verifica el código SAS de 6 dígitos cara a cara.
                        </p>
                      </div>

                      {/* 3. Desinstalación (Requisito 11) */}
                      <div className="space-y-1 text-[#94A3B8]">
                        <h4 className="font-bold text-white text-[11px]">3. Desinstalación de la aplicación PWA</h4>
                        <p className="text-[10px] leading-relaxed">
                          VEL puede desinstalarse en cualquier momento manteniendo presionado el ícono de VEL en la pantalla de inicio o desde la configuración de aplicaciones del navegador.
                        </p>
                        <p className="text-[10px] text-[#F59E0B] leading-tight">
                          Nota: Desinstalar la PWA o borrar los datos del sitio en VEL CORE elimina permanentemente los datos cifrados locales de ese navegador.
                        </p>
                      </div>

                      {/* 4. Cláusula de independencia entre uso técnico y contratación externa (Requisito 12) */}
                      <div className="p-2.5 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#FCA5A5] space-y-1">
                        <h4 className="font-extrabold text-[11px] text-white">Independencia de datos en VEL CORE:</h4>
                        <p className="text-[10px] leading-relaxed">
                          No se cobra por instalar, reinstalar, configurar, reemplazar o revocar dispositivos. Tus datos e identidades permanecen bajo tu custodia exclusiva en VEL CORE.
                        </p>
                      </div>

                      {/* Enlace al contrato */}
                      <div className="pt-1 border-t border-[#22324C]">
                        <a
                          href={OFFICIAL_CONTRACT_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-[#00CFE8] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Consultar términos y condiciones</span>
                        </a>
                      </div>

                      <button
                        onClick={() => setShowHelpModal(false)}
                        className="w-full h-9 rounded-xl bg-[#00CFE8] text-[#0B1220] font-bold text-xs cursor-pointer"
                      >
                        Entendido
                      </button>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* VISTA 2: INSTALACIÓN DE VEL COMO PWA OFICIAL */}
        {/* ========================================================= */}
        {viewMode === 'INSTALL_INFO' && (
          <div className="max-w-2xl w-full bg-[#111C2E] border border-[#22324C] rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="border-b border-[#22324C] pb-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[#00CFE8]">
                  <Download className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Instalación en tu teléfono</span>
                </div>
                <button
                  type="button"
                  onClick={goHome}
                  className="h-8 px-3 rounded-lg bg-[#0B1220] hover:bg-[#18263E] border border-[#22324C] text-[#00CFE8] hover:text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>VOLVER AL INICIO</span>
                </button>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-white">
                Instalar VEL en tus teléfonos (CORE y MÓVIL)
              </h2>
              <p className="text-xs text-[#94A3B8]">
                Puedes agregar VEL a la pantalla de inicio en ambos teléfonos directamente desde el navegador.
              </p>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#0B1220] border border-[#22324C] space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-[#10B981]" />
                    <span>Estado de instalación</span>
                  </h4>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#10B981]/15 text-[#10B981]">
                    {pwa.isInstalled ? 'YA INSTALADA EN ESTE EQUIPO' : 'LISTA PARA INSTALAR'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-[#111C2E] border border-[#22324C]">
                    <span className="text-[#94A3B8] block text-[10px]">Aplicación:</span>
                    <span className="text-white font-semibold text-xs">VEL</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#111C2E] border border-[#22324C]">
                    <span className="text-[#94A3B8] block text-[10px]">Modo de apertura:</span>
                    <span className="text-white font-semibold text-xs">Pantalla completa ✓</span>
                  </div>
                </div>

                <PWAInstallButton pwa={pwa} />
              </div>

              <div className="p-4 rounded-2xl bg-[#0B1220] border border-[#22324C] space-y-2.5 text-xs text-[#94A3B8]">
                <h4 className="text-sm font-bold text-white">Cómo instalar manualmente</h4>
                <div className="space-y-1.5 leading-relaxed">
                  <p>
                    <strong className="text-[#00CFE8]">Android (Chrome / Edge):</strong> Abre esta misma dirección en tu navegador, toca el menú{' '}
                    <strong className="text-white">⋮</strong> y selecciona{' '}
                    <strong className="text-white">«Instalar aplicación»</strong> o{' '}
                    <strong className="text-white">«Agregar a la pantalla principal»</strong>.
                  </p>
                  <p>
                    <strong className="text-[#10B981]">iPhone / iPad (Safari):</strong> Abre VEL en Safari, pulsa{' '}
                    <strong className="text-white">Compartir</strong> y luego{' '}
                    <strong className="text-white">«Agregar a inicio»</strong>.
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-[#111C2E] border border-[#22324C] text-[11px] leading-snug">
                  <strong className="text-white">Nota:</strong> No hace falta buscar ni instalar archivos externos para usar VEL en tus teléfonos.
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
