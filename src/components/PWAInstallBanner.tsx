import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, RefreshCw, CheckCircle, X } from 'lucide-react';
import { PWAInstallState } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  pwa: PWAInstallState;
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ pwa, compact = false }) => {
  const [showManualModal, setShowManualModal] = useState(false);

  if (pwa.isInstalled) {
    return (
      <span
        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30 shrink-0"
        title="VEL se está ejecutando como aplicación PWA instalada"
      >
        <CheckCircle className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">PWA instalada</span>
      </span>
    );
  }

  const handleClick = async () => {
    if (pwa.isInstallable) {
      const outcome = await pwa.promptInstall();
      if (outcome === 'unavailable') {
        setShowManualModal(true);
      }
    } else {
      setShowManualModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={
          compact
            ? 'px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 bg-[#10B981] hover:bg-[#059669] text-[#0B1220] transition-all cursor-pointer shadow-md shrink-0'
            : 'w-full h-10 rounded-xl bg-[#10B981] hover:bg-[#059669] text-[#0B1220] font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md'
        }
        title="Instalar aplicación web PWA en este dispositivo"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{compact ? 'Instalar VEL' : 'Instalar aplicación VEL (PWA)'}</span>
      </button>

      {showManualModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-[#111C2E] border border-[#22324C] rounded-2xl p-5 space-y-4 shadow-2xl text-xs">
            <div className="flex items-center justify-between border-b border-[#22324C] pb-2.5">
              <div className="flex items-center gap-2 text-[#00CFE8] font-bold text-sm">
                <Smartphone className="w-4 h-4" />
                <span>Instalar VEL en tu teléfono</span>
              </div>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="text-[#94A3B8] hover:text-white cursor-pointer"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pwa.isIOS ? (
              <div className="space-y-2 text-[#94A3B8] leading-relaxed">
                <p className="text-white font-semibold">Instrucciones para Safari (iOS / iPadOS):</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Abre esta página en <strong className="text-white">Safari</strong>.</li>
                  <li>Toca el ícono <strong className="text-white">Compartir</strong> (cuadrado con flecha hacia arriba).</li>
                  <li>Selecciona <strong className="text-[#00CFE8]">"Agregar a inicio"</strong> y confirma con <strong className="text-white">Agregar</strong>.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-2 text-[#94A3B8] leading-relaxed">
                <p className="text-white font-semibold">Instrucciones para Chrome / Edge (Android o escritorio):</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Abre el menú del navegador (tres puntos <strong className="text-white">⋮</strong> arriba a la derecha).</li>
                  <li>Elige <strong className="text-[#00CFE8]">"Instalar aplicación"</strong> o <strong className="text-white">"Agregar a la pantalla principal"</strong>.</li>
                  <li>Confirma para crear el ícono directo de <strong className="text-white">VEL</strong> sin barra de navegador.</li>
                </ol>
              </div>
            )}

            <p className="text-[11px] text-[#94A3B8] bg-[#0B1220] border border-[#22324C] p-2.5 rounded-xl">
              Nota: VEL funciona como aplicación web progresiva (PWA) directamente desde este dominio oficial. No requiere instalar archivos APK ni descargas ZIP externas.
            </p>

            <button
              type="button"
              onClick={() => setShowManualModal(false)}
              className="w-full h-9 rounded-xl bg-[#00CFE8] text-[#0B1220] font-bold text-xs cursor-pointer"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC<{ isOnline: boolean }> = ({ isOnline }) => {
  if (isOnline) return null;
  return (
    <div className="bg-[#F59E0B]/15 border-b border-[#F59E0B]/40 text-[#FCD34D] px-4 py-2 text-xs flex items-center justify-center gap-2 text-center">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>
        <strong>Sin conexión a internet:</strong> el Relay y Firebase están en espera; VEL CORE mantiene accesible su bóveda local cifrada.
      </span>
    </div>
  );
};

export const SWUpdateBanner: React.FC<{
  visible: boolean;
  onUpdate: () => Promise<void>;
}> = ({ visible, onUpdate }) => {
  if (!visible) return null;
  return (
    <div className="bg-[#00CFE8]/15 border-b border-[#00CFE8]/40 text-white px-4 py-2 text-xs flex items-center justify-center gap-3 flex-wrap">
      <span className="flex items-center gap-1.5">
        <RefreshCw className="w-3.5 h-3.5 text-[#00CFE8]" />
        <span>Hay una nueva versión oficial de <strong>VEL</strong> lista para aplicar.</span>
      </span>
      <button
        type="button"
        onClick={() => void onUpdate()}
        className="px-3 py-1 rounded-lg bg-[#00CFE8] hover:bg-[#00b8ce] text-[#0B1220] font-bold text-[11px] cursor-pointer"
      >
        Actualizar ahora
      </button>
    </div>
  );
};
