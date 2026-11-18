import React, { useRef } from 'react';
import {
  Camera,
  CheckCircle,
  File,
  FileText,
  Film,
  Image as ImageIcon,
  Lock,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  XCircle
} from 'lucide-react';
import {
  FileTransferCategory,
  FileTransferItemState,
  FileTransferService,
  FileTransferSnapshot,
  formatFileSizeHuman
} from '../services/fileTransferService';
import { RelayConnectionState } from '../contracts/velContracts';

interface MobileFileTransferPanelProps {
  transferService: FileTransferService;
  snapshot: FileTransferSnapshot;
  connectionState: RelayConnectionState;
  peerOnline: boolean;
  isRevoked: boolean;
  isPaired: boolean;
}

function getCategoryLabel(category: FileTransferCategory): string {
  switch (category) {
    case 'PHOTO':
      return 'Foto';
    case 'VIDEO':
      return 'Vídeo';
    case 'PDF':
      return 'PDF';
    default:
      return 'Archivo';
  }
}

function renderCategoryIcon(category: FileTransferCategory) {
  switch (category) {
    case 'PHOTO':
      return <ImageIcon className="w-3.5 h-3.5 text-[#00CFE8] shrink-0" />;
    case 'VIDEO':
      return <Film className="w-3.5 h-3.5 text-[#00CFE8] shrink-0" />;
    case 'PDF':
      return <FileText className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />;
    default:
      return <File className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />;
  }
}

function isTransferActiveStatus(status: FileTransferItemState['status']): boolean {
  return (
    status === 'PREPARING' ||
    status === 'ENCRYPTING' ||
    status === 'SENDING' ||
    status === 'RECEIVING_IN_CORE' ||
    status === 'VERIFYING_INTEGRITY' ||
    status === 'SAVING_IN_CORE_VAULT'
  );
}

function getStatusBadgeClasses(status: FileTransferItemState['status']): string {
  switch (status) {
    case 'PROTECTED_IN_CORE':
      return 'bg-[#10B981]/15 text-[#10B981] border-[#10B981]/30';
    case 'INTERRUPTED':
      return 'bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30';
    case 'FAILED':
      return 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30';
    case 'SELECTED':
      return 'bg-[#94A3B8]/15 text-[#CBD5E1] border-[#94A3B8]/30';
    default:
      return 'bg-[#00CFE8]/15 text-[#00CFE8] border-[#00CFE8]/30';
  }
}

export const MobileFileTransferPanel: React.FC<MobileFileTransferPanelProps> = ({
  transferService,
  snapshot,
  connectionState,
  peerOnline,
  isRevoked,
  isPaired
}) => {
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const otherInputRef = useRef<HTMLInputElement | null>(null);

  const canSendNow = !isRevoked && isPaired && connectionState === 'LINKED' && peerOnline;
  const pendingCount = snapshot.outgoing.filter((i) => i.status === 'SELECTED').length;
  const protectedCount = snapshot.outgoing.filter((i) => i.status === 'PROTECTED_IN_CORE').length;

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      transferService.selectFiles(Array.from(fileList));
    }
    e.target.value = '';
  };

  return (
    <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#00CFE8]/30 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-white flex items-center gap-1.5">
          <Upload className="w-3.5 h-3.5 text-[#00CFE8]" />
          <span>Enviar archivos a VEL CORE</span>
        </span>
        <span className="text-[10px] font-semibold text-[#94A3B8]">
          Máx. 100 MB/archivo
        </span>
      </div>

      {/* Inputs ocultos por tipo */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />
      <input
        ref={otherInputRef}
        type="file"
        accept="*/*"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />

      {/* Botones rápidos de selección */}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={isRevoked}
          onClick={() => photoInputRef.current?.click()}
          className="h-9 px-2.5 rounded-xl bg-[#0B1220] hover:bg-[#18263E] border border-[#22324C] text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
        >
          <Camera className="w-3.5 h-3.5 text-[#00CFE8]" />
          <span>Fotos</span>
        </button>

        <button
          type="button"
          disabled={isRevoked}
          onClick={() => videoInputRef.current?.click()}
          className="h-9 px-2.5 rounded-xl bg-[#0B1220] hover:bg-[#18263E] border border-[#22324C] text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
        >
          <Film className="w-3.5 h-3.5 text-[#00CFE8]" />
          <span>Vídeos</span>
        </button>

        <button
          type="button"
          disabled={isRevoked}
          onClick={() => pdfInputRef.current?.click()}
          className="h-9 px-2.5 rounded-xl bg-[#0B1220] hover:bg-[#18263E] border border-[#22324C] text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
        >
          <FileText className="w-3.5 h-3.5 text-[#F59E0B]" />
          <span>PDFs</span>
        </button>

        <button
          type="button"
          disabled={isRevoked}
          onClick={() => otherInputRef.current?.click()}
          className="h-9 px-2.5 rounded-xl bg-[#0B1220] hover:bg-[#18263E] border border-[#22324C] text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
        >
          <File className="w-3.5 h-3.5 text-[#10B981]" />
          <span>Otros archivos</span>
        </button>
      </div>

      {!canSendNow && (
        <div className="p-2 rounded-xl bg-[#0B1220] border border-[#F59E0B]/30 text-[10px] text-[#F59E0B] leading-snug">
          {isRevoked
            ? 'Este dispositivo fue revocado por VEL CORE y no puede enviar archivos.'
            : !isPaired
            ? 'Vincula primero este teléfono con tu VEL CORE para enviar archivos cifrados.'
            : connectionState !== 'LINKED'
            ? 'Esperando canal cifrado E2EE activo con VEL CORE.'
            : 'Tu VEL CORE figura desconectado. Conecta VEL CORE para iniciar la transferencia.'}
        </div>
      )}

      {(pendingCount > 0 || protectedCount > 0) && (
        <div className="flex items-center justify-between gap-2">
          {pendingCount > 0 ? (
            <button
              type="button"
              disabled={snapshot.hasActiveTransfer || !canSendNow}
              onClick={() => void transferService.sendPendingFiles()}
              className="flex-1 h-8 px-3 rounded-lg bg-[#10B981] hover:bg-[#0ea571] text-[#0B1220] font-bold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-45"
            >
              <Send className="w-3 h-3" />
              <span>
                Enviar pendiente{pendingCount === 1 ? '' : 's'} ({pendingCount})
              </span>
            </button>
          ) : (
            <div />
          )}

          {protectedCount > 0 && (
            <button
              type="button"
              onClick={() => transferService.clearCompletedOutgoing()}
              className="h-8 px-2.5 rounded-lg bg-[#0B1220] hover:bg-[#18263E] border border-[#22324C] text-[10px] font-semibold text-[#94A3B8] hover:text-white cursor-pointer shrink-0"
            >
              Limpiar protegidos
            </button>
          )}
        </div>
      )}

      {snapshot.outgoing.length > 0 && (
        <div className="max-h-64 overflow-y-auto space-y-2 pr-0.5">
          {snapshot.outgoing.map((item) => {
            const active = isTransferActiveStatus(item.status);
            return (
              <div
                key={item.localId}
                className="p-2.5 rounded-xl bg-[#0B1220] border border-[#22324C] space-y-1.5 text-[11px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {renderCategoryIcon(item.category)}
                    <div className="min-w-0">
                      <p className="text-white font-semibold truncate">{item.fileName}</p>
                      <p className="text-[10px] text-[#94A3B8]">
                        {getCategoryLabel(item.category)} · {formatFileSizeHuman(item.sizeBytes)}
                        {item.totalChunks > 1 ? ` · ${item.chunksConfirmed}/${item.totalChunks} bloques` : ''}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-bold shrink-0 ${getStatusBadgeClasses(
                      item.status
                    )}`}
                  >
                    {item.statusLabel}
                  </span>
                </div>

                {(active || item.status === 'PROTECTED_IN_CORE' || item.progressPercent > 0) && (
                  <div className="w-full h-1.5 rounded-full bg-[#18263E] overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        item.status === 'PROTECTED_IN_CORE'
                          ? 'bg-[#10B981]'
                          : item.status === 'INTERRUPTED'
                          ? 'bg-[#F59E0B]'
                          : item.status === 'FAILED'
                          ? 'bg-[#EF4444]'
                          : 'bg-[#00CFE8]'
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, item.progressPercent))}%` }}
                    />
                  </div>
                )}

                {item.errorMessage && (
                  <p className="text-[10px] text-[#FCA5A5] leading-snug">{item.errorMessage}</p>
                )}

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  {item.status === 'PROTECTED_IN_CORE' ? (
                    <span className="text-[10px] text-[#10B981] font-semibold inline-flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      <span>Guardado y verificado en VEL CORE</span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#94A3B8]">
                      {active ? `${item.progressPercent}%` : ''}
                    </span>
                  )}

                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'SELECTED' && (
                      <button
                        type="button"
                        disabled={snapshot.hasActiveTransfer || !canSendNow}
                        onClick={() => void transferService.sendFile(item.localId)}
                        className="px-2 py-0.5 rounded bg-[#00CFE8] text-[#0B1220] font-bold text-[10px] cursor-pointer disabled:opacity-45"
                      >
                        Enviar
                      </button>
                    )}

                    {active && (
                      <button
                        type="button"
                        onClick={() => transferService.cancelOutgoingTransfer(item.localId)}
                        className="px-2 py-0.5 rounded bg-[#EF4444]/15 border border-[#EF4444]/40 text-[#EF4444] font-bold text-[10px] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <XCircle className="w-3 h-3" />
                        <span>Detener</span>
                      </button>
                    )}

                    {(item.status === 'INTERRUPTED' || item.status === 'FAILED') && item.canRetry && (
                      <button
                        type="button"
                        disabled={snapshot.hasActiveTransfer || !canSendNow}
                        onClick={() => void transferService.retryFile(item.localId)}
                        className="px-2 py-0.5 rounded bg-[#F59E0B] text-[#0B1220] font-bold text-[10px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-45"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Reintentar</span>
                      </button>
                    )}

                    {!active && (
                      <button
                        type="button"
                        onClick={() => transferService.removeOutgoingItem(item.localId)}
                        className="text-[10px] text-[#94A3B8] hover:text-white inline-flex items-center gap-0.5 cursor-pointer"
                        title="Quitar de la lista"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Quitar</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-[#94A3B8] leading-snug flex items-start gap-1.5">
        <Lock className="w-3 h-3 text-[#10B981] shrink-0 mt-0.5" />
        <span>
          Los archivos no se guardan en este móvil; solo se mantienen en memoria temporal durante el envío hasta que VEL CORE confirma su guardado cifrado.
        </span>
      </p>
    </div>
  );
};
