import React, { useEffect, useState } from 'react';
import {
  CheckCircle,
  Download,
  Eye,
  EyeOff,
  File,
  FileText,
  Film,
  FolderLock,
  Image as ImageIcon,
  RefreshCw,
  Trash2
} from 'lucide-react';
import {
  coreFileVault,
  CoreVaultFileSummary
} from '../db/coreFileVault';
import {
  CoreIncomingTransferState,
  FileTransferService,
  formatFileSizeHuman
} from '../services/fileTransferService';

interface CoreBinaryVaultPanelProps {
  transferService: FileTransferService;
  incomingTransfers: CoreIncomingTransferState[];
  vaultRevision: number;
}

interface PreviewState {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  objectUrl: string;
}

function renderFileIcon(mimeType: string, fileName: string) {
  const lowerMime = (mimeType || '').toLowerCase();
  const lowerName = (fileName || '').toLowerCase();
  if (lowerMime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp)$/.test(lowerName)) {
    return <ImageIcon className="w-3.5 h-3.5 text-[#00CFE8] shrink-0" />;
  }
  if (lowerMime.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/.test(lowerName)) {
    return <Film className="w-3.5 h-3.5 text-[#00CFE8] shrink-0" />;
  }
  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return <FileText className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />;
  }
  return <File className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />;
}

export const CoreBinaryVaultPanel: React.FC<CoreBinaryVaultPanelProps> = ({
  transferService,
  incomingTransfers,
  vaultRevision
}) => {
  const [files, setFiles] = useState<CoreVaultFileSummary[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const previewUrlRef = React.useRef<string | null>(null);

  const revokeUrl = (url: string | null | undefined) => {
    if (url) {
      URL.revokeObjectURL(url);
    }
  };

  const refreshFiles = async () => {
    setIsLoadingList(true);
    try {
      const list = await coreFileVault.listFiles();
      setFiles(list);
      setErrorMsg(null);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo leer la bóveda binaria de VEL CORE.');
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    void refreshFiles();
  }, [vaultRevision]);

  useEffect(() => {
    previewUrlRef.current = preview?.objectUrl ?? null;
  }, [preview]);

  useEffect(() => {
    return () => {
      revokeUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, []);

  const handleClosePreview = () => {
    setPreview((curr) => {
      revokeUrl(curr?.objectUrl);
      return null;
    });
  };

  const handleOpenFile = async (fileId: string) => {
    setBusyFileId(fileId);
    setErrorMsg(null);
    try {
      const { metadata, blob } = await coreFileVault.openProtectedFileAsBlob(fileId);
      const nextUrl = URL.createObjectURL(blob);
      setPreview((prev) => {
        revokeUrl(prev?.objectUrl);
        return {
          fileId: metadata.fileId,
          fileName: metadata.fileName,
          mimeType: metadata.mimeType,
          sizeBytes: metadata.sizeBytes,
          objectUrl: nextUrl
        };
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo descifrar y abrir este archivo en VEL CORE.');
    } finally {
      setBusyFileId(null);
    }
  };

  const handleDownloadFile = async (fileId: string) => {
    setBusyFileId(fileId);
    setErrorMsg(null);
    try {
      const { metadata, blob } = await coreFileVault.openProtectedFileAsBlob(fileId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = metadata.fileName || 'archivo-vel-core';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo exportar este archivo desde VEL CORE.');
    } finally {
      setBusyFileId(null);
    }
  };

  const handleConfirmDelete = async (fileId: string) => {
    setBusyFileId(fileId);
    setErrorMsg(null);
    try {
      await coreFileVault.deleteFile(fileId);
      if (preview?.fileId === fileId) {
        handleClosePreview();
      }
      setConfirmDeleteId(null);
      await refreshFiles();
    } catch (err: any) {
      setErrorMsg(err?.message || 'No se pudo eliminar el archivo de la bóveda CORE.');
    } finally {
      setBusyFileId(null);
    }
  };

  const hasFinishedIncoming = incomingTransfers.some(
    (item) =>
      item.status === 'PROTECTED_IN_CORE' ||
      item.status === 'INTERRUPTED' ||
      item.status === 'FAILED'
  );

  return (
    <div className="p-3.5 rounded-2xl bg-[#111C2E] border border-[#00CFE8]/30 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-white flex items-center gap-1.5">
          <FolderLock className="w-3.5 h-3.5 text-[#00CFE8]" />
          <span>Archivos protegidos en CORE</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#00CFE8] font-bold">
            {files.length} archivo{files.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={() => void refreshFiles()}
            disabled={isLoadingList}
            className="text-[#94A3B8] hover:text-white cursor-pointer disabled:opacity-50"
            title="Actualizar lista de archivos"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingList ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Recepciones en curso o recientes desde VEL MÓVIL */}
      {incomingTransfers.length > 0 && (
        <div className="p-2.5 rounded-xl bg-[#0B1220] border border-[#22324C] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-[#00CFE8]">
              Recepción desde VEL MÓVIL
            </span>
            {hasFinishedIncoming && (
              <button
                type="button"
                onClick={() => transferService.clearFinishedIncoming()}
                className="text-[10px] text-[#94A3B8] hover:text-white cursor-pointer"
              >
                Limpiar historial
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {incomingTransfers.map((item) => (
              <div key={item.fileId} className="space-y-1 text-[10px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white font-semibold truncate">{item.fileName}</span>
                  <span
                    className={`font-bold shrink-0 ${
                      item.status === 'PROTECTED_IN_CORE'
                        ? 'text-[#10B981]'
                        : item.status === 'INTERRUPTED'
                        ? 'text-[#F59E0B]'
                        : item.status === 'FAILED'
                        ? 'text-[#EF4444]'
                        : 'text-[#00CFE8]'
                    }`}
                  >
                    {item.statusLabel}
                  </span>
                </div>
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
                {item.errorMessage && (
                  <p className="text-[#FCA5A5] leading-tight">{item.errorMessage}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {errorMsg && (
        <p className="text-[10px] text-[#EF4444] leading-snug">{errorMsg}</p>
      )}

      {/* Visor temporal en memoria del archivo descifrado */}
      {preview && (
        <div className="p-2.5 rounded-xl bg-[#0B1220] border border-[#10B981]/40 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[#10B981] truncate">{preview.fileName}</p>
              <p className="text-[9px] text-[#94A3B8]">
                {preview.mimeType} · {formatFileSizeHuman(preview.sizeBytes)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClosePreview}
              className="text-[10px] text-[#94A3B8] hover:text-white inline-flex items-center gap-0.5 cursor-pointer shrink-0"
            >
              <EyeOff className="w-3 h-3" />
              <span>Cerrar</span>
            </button>
          </div>

          {preview.mimeType.startsWith('image/') ? (
            <img
              src={preview.objectUrl}
              alt={preview.fileName}
              className="w-full max-h-56 object-contain rounded-lg bg-black/40"
            />
          ) : preview.mimeType.startsWith('video/') ? (
            <video
              src={preview.objectUrl}
              controls
              className="w-full max-h-56 rounded-lg bg-black"
            />
          ) : preview.mimeType === 'application/pdf' ||
            preview.fileName.toLowerCase().endsWith('.pdf') ? (
            <iframe
              src={preview.objectUrl}
              title={preview.fileName}
              className="w-full h-56 rounded-lg bg-white"
            />
          ) : (
            <div className="p-2 rounded-lg bg-[#111C2E] border border-[#22324C] text-[10px] text-[#CBD5E1] flex items-center justify-between gap-2">
              <span>Archivo listo para descargar en tu dispositivo principal.</span>
              <a
                href={preview.objectUrl}
                download={preview.fileName}
                className="px-2 py-1 rounded bg-[#00CFE8] text-[#0B1220] font-bold shrink-0"
              >
                Descargar
              </a>
            </div>
          )}
        </div>
      )}

      {/* Lista de archivos confirmados */}
      {files.length === 0 ? (
        <p className="text-[11px] text-[#94A3B8] leading-snug">
          Todavía no hay fotografías, vídeos ni documentos guardados desde VEL MÓVIL.
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto space-y-1.5 pr-0.5">
          {files.map((file) => {
            const isBusy = busyFileId === file.fileId;
            return (
              <div
                key={file.fileId}
                className="p-2 rounded-xl bg-[#0B1220] border border-[#22324C] space-y-1.5 text-[10px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {renderFileIcon(file.mimeType, file.fileName)}
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-[11px] truncate">
                        {file.fileName}
                      </p>
                      <p className="text-[#94A3B8]">
                        {formatFileSizeHuman(file.sizeBytes)} ·{' '}
                        {new Date(file.confirmedAt || file.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span className="text-[#10B981] font-bold inline-flex items-center gap-0.5 shrink-0">
                    <CheckCircle className="w-3 h-3" />
                    <span>Protegido</span>
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleOpenFile(file.fileId)}
                    className="px-2 py-0.5 rounded bg-[#00CFE8]/15 border border-[#00CFE8]/30 text-[#00CFE8] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Abrir</span>
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleDownloadFile(file.fileId)}
                    className="px-2 py-0.5 rounded bg-[#18263E] border border-[#22324C] text-white font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3 h-3" />
                    <span>Descargar</span>
                  </button>

                  {confirmDeleteId === file.fileId ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleConfirmDelete(file.fileId)}
                        className="px-2 py-0.5 rounded bg-[#EF4444] text-white font-bold cursor-pointer disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-1.5 py-0.5 rounded bg-[#18263E] text-[#94A3B8] cursor-pointer"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setConfirmDeleteId(file.fileId)}
                      className="text-[#EF4444] hover:underline inline-flex items-center gap-0.5 cursor-pointer disabled:opacity-50"
                      title="Eliminar de bóveda CORE"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Eliminar</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-[#94A3B8] leading-snug">
        Tus archivos recibidos se cifran por bloques AES-256-GCM en la bóveda local de este VEL CORE sin copias en servidores externos.
      </p>
    </div>
  );
};
