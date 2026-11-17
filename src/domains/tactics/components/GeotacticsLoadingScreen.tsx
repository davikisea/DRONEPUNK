import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Volume2, VolumeX, Cpu } from 'lucide-react';
import { catalogRegistry } from '@shared';

interface GeotacticsLoadingScreenProps {
  mapName?: string;
  onLoadingComplete?: () => void;
  autoProceed?: boolean;
  autoProceedDelayMs?: number;
  isBootScreen?: boolean;
}

export const GeotacticsLoadingScreen: React.FC<GeotacticsLoadingScreenProps> = ({
  mapName,
  onLoadingComplete,
  autoProceed = true,
  autoProceedDelayMs = 200,
  isBootScreen = true,
}) => {
  const [progress, setProgress] = useState<number>(0);
  const [ghostProgress, setGhostProgress] = useState<number>(0);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [audioMuted, setAudioMuted] = useState<boolean>(false);
  const [zuluTime, setZuluTime] = useState<string>('');

  const audioCtxRef = useRef<AudioContext | null>(null);

  // Sintetizador procedural rápido para clics de telemetría y pulsos
  const playTacticalBlip = useCallback((freq = 440, type: OscillatorType = 'sine', duration = 0.03) => {
    if (audioMuted) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      const osc = audioCtxRef.current.createOscillator();
      const gain = audioCtxRef.current.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtxRef.current.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtxRef.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtxRef.current.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtxRef.current.destination);
      osc.start();
      osc.stop(audioCtxRef.current.currentTime + duration);
    } catch {
      // AudioContext bloqueado hasta interacción de usuario, ignorar de forma segura
    }
  }, [audioMuted]);

  const playHeavyDeploySound = useCallback(() => {
    if (audioMuted) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const osc = audioCtxRef.current.createOscillator();
      const gain = audioCtxRef.current.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, audioCtxRef.current.currentTime);
      osc.frequency.exponentialRampToValueAtTime(45, audioCtxRef.current.currentTime + 0.16);
      gain.gain.setValueAtTime(0.3, audioCtxRef.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtxRef.current.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(audioCtxRef.current.destination);
      osc.start();
      osc.stop(audioCtxRef.current.currentTime + 0.18);
    } catch {
      // safe ignore
    }
  }, [audioMuted]);

  // Reloj militar Zulu en tiempo real
  useEffect(() => {
    // Sincronización en caliente de catálogos SSOT en segundo plano (< 300 ms)
    catalogRegistry.synchronizeWithServer().catch((e) => {
      console.warn('[GeotacticsLoadingScreen] Sincronización de catálogos omitida:', e);
    });

    const updateZulu = () => {
      const now = new Date();
      const h = String(now.getUTCHours()).padStart(2, '0');
      const m = String(now.getUTCMinutes()).padStart(2, '0');
      const s = String(now.getUTCSeconds()).padStart(2, '0');
      setZuluTime(`${h}:${m}:${s}Z`);
    };
    updateZulu();
    const timer = setInterval(updateZulu, 1000);
    return () => clearInterval(timer);
  }, []);

  // Animación del progreso de precarga y Ghost Bar
  useEffect(() => {
    let currentPct = 0;
    const interval = setInterval(() => {
      currentPct += Math.floor(Math.random() * 9) + 4;
      if (currentPct >= 100) {
        currentPct = 100;
        clearInterval(interval);
        setProgress(100);
        setIsReady(true);
        playTacticalBlip(880, 'triangle', 0.08);
      } else {
        setProgress(currentPct);
        playTacticalBlip(320 + currentPct * 3, 'sine', 0.02);
      }
    }, 120);

    return () => clearInterval(interval);
  }, [playTacticalBlip]);

  // Ghost bar que sigue al progreso real con retardo (Surge Trail)
  useEffect(() => {
    const timeout = setTimeout(() => {
      setGhostProgress(progress);
    }, 180);
    return () => clearTimeout(timeout);
  }, [progress]);

  // Transición automática inmediata al Cuartel General cuando la precarga llega al 100%
  useEffect(() => {
    if (isReady && onLoadingComplete) {
      const timer = setTimeout(() => {
        playHeavyDeploySound();
        onLoadingComplete();
      }, autoProceedDelayMs);
      return () => clearTimeout(timer);
    }
  }, [isReady, autoProceedDelayMs, onLoadingComplete, playHeavyDeploySound]);

  return (
    <div className="relative w-full h-full min-h-screen bg-[#161712] text-[#F2E8D5] flex flex-col items-center justify-between p-4 sm:p-6 lg:p-8 select-none overflow-hidden font-sans">
      {/* 1. FONDO DIEGÉTICO RETRO: Rejilla balística atenuada + Scanlines CRT + Viñeta */}
      <div className="absolute inset-0 bg-[radial-gradient(#2B2C24_1px,transparent_1px)] [background-size:24px_24px] opacity-30 pointer-events-none" />
      <div className="absolute inset-0 ben-day-dark opacity-25 pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.3)_50%)] bg-[length:100%_4px] opacity-40 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0A0B08]/90 via-transparent to-[#0A0B08]/80 pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_140px_rgba(10,11,8,0.95)]" />

      {/* 2. CABECERA MINIMALISTA C4ISR */}
      <header className="relative z-10 w-full max-w-4xl flex items-center justify-between gap-3 border-b border-[#2B2C24] pb-3 text-[11px] font-mono">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="DRONEPUNK" className="w-4 h-4 object-contain" />
          <span className="font-bold text-[#F2E8D5] uppercase tracking-widest">
            DRONEPUNK // C4ISR NETLINK
          </span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00FF66] shadow-[0_0_6px_#00FF66] animate-pulse" />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold text-[#A9B87A] tabular-nums tracking-widest">
            ZULU: {zuluTime || '00:00:00Z'}
          </span>
          <button
            type="button"
            onClick={() => setAudioMuted(m => !m)}
            title={audioMuted ? 'Activar Audio Táctico' : 'Silenciar Audio Táctico'}
            className="w-7 h-7 rounded-[6px_2px_6px_2px] bg-[#1B1D17] hover:bg-[#2B2C24] border border-[#46521F] flex items-center justify-center cursor-pointer transition-colors"
          >
            {audioMuted ? (
              <VolumeX className="w-3.5 h-3.5 text-stone-500" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-[#F2E8D5]" />
            )}
          </button>
        </div>
      </header>

      {/* 3. NÚCLEO CENTRAL MINIMALISTA: ICONO PEQUEÑO + TÍTULO + LORE RETRO */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center my-4 max-w-xl w-full">
        {/* Emblema compacto centrado */}
        <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-[8px_2px_8px_2px] bg-[#1B1D17]/90 border border-[#46521F] shadow-[3px_3px_0px_#0A0B08] flex items-center justify-center p-3">
          <div className="absolute inset-0 bg-[radial-gradient(#46521F_0.5px,transparent_0.5px)] [background-size:6px_6px] opacity-25 pointer-events-none" />
          <picture>
            <source srcSet="/icon.svg" type="image/svg+xml" />
            <img
              src="/icon.png"
              alt="DRONEPUNK"
              className="relative z-10 w-10 h-10 sm:w-12 sm:h-12 object-contain drop-shadow-[0_0_10px_rgba(196,106,58,0.4)] select-none pointer-events-none"
            />
          </picture>
        </div>

        {/* Cabecera tipográfica limpia */}
        <div className="mt-4 space-y-1.5">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-black font-display tracking-[0.22em] text-[#F2E8D5] uppercase flex items-baseline justify-center gap-2">
            <span>
              <span className="text-[#F2E8D5]">DRONE</span>
              <span className="text-[#C46A3A]">PUNK</span>
            </span>
            <span className="text-[11px] font-mono font-bold tracking-widest text-[#7B8A4A]">
              v0.0.1
            </span>
          </h1>
          <p className="text-[10px] sm:text-[11px] font-mono font-bold text-[#A9B87A] tracking-[0.18em] uppercase">
            {mapName ? `SECTOR OPERACIONAL: ${mapName}` : 'CONSOLA DE MANDO TÁCTICO & HEGEMONÍA TERRITORIAL'}
          </p>
        </div>

        {/* Bloque de Lore diegético retro-militar */}
        <div className="max-w-lg w-full mt-5 px-4 py-3.5 bg-[#11130E]/90 border border-[#2B2C24] border-l-2 border-l-[#C46A3A] rounded-[6px_2px_6px_2px] shadow-[4px_4px_0px_#0A0B08] text-left font-mono">
          <div className="flex items-center justify-between text-[10px] font-bold tracking-widest text-[#C46A3A] uppercase mb-2">
            <span>ARCHIVO C4ISR // CRÓNICA DEL COLAPSO ORBITAL</span>
            <span className="text-[#00FF66] animate-pulse">█</span>
          </div>
          <p className="text-[11px] sm:text-xs leading-relaxed text-[#D8D1C5]/90">
            Tras la caída de los satélites de viejo orden, las naciones se fragmentaron en zonas de exclusión industrial. Hoy la soberanía no se decreta en parlamentos: se forja en altos hornos, se transporta por corredores blindados y se disputa celda a celda bajo el zumbido de los enjambres tácticos.
          </p>
        </div>
      </main>

      {/* 4. PIE DE CARGA MINIMALISTA CON GHOST TRAIL */}
      <footer className="relative z-10 max-w-lg w-full space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="flex items-center gap-2 text-[#D8D1C5] font-bold">
              <Cpu className="w-3.5 h-3.5 text-[#C46A3A]" />
              {isReady
                ? 'ENLACE AL ESTADO MAYOR ESTABLECIDO'
                : 'SINCRONIZANDO BÚFERES TÁCTICOS Y PROTOCOLOS DE MANDO...'}
            </span>
            <span className="text-amber-400 font-black tabular-nums tracking-widest">
              [{progress}%]
            </span>
          </div>

          <div className="relative h-2.5 bg-[#0E0F0B] border border-[#46521F] rounded-[6px_2px_6px_2px] shadow-[2px_2px_0px_#0A0B08] overflow-hidden p-0.5">
            <div
              className="absolute inset-y-0.5 left-0.5 bg-[#F2E8D5] rounded-[3px_1px_3px_1px] bar-ghost-trail"
              style={{ width: `calc(${ghostProgress}% - 4px)` }}
            />
            <div
              className="absolute inset-y-0.5 left-0.5 bg-gradient-to-r from-[#C46A3A] via-[#E65100] to-[#F59E0B] rounded-[3px_1px_3px_1px] bar-fill-spring"
              style={{ width: `calc(${progress}% - 4px)` }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] font-mono text-[#7B8A4A]">
          <span>WebGL 2.0 Zero-Raster</span>
          <span>•</span>
          <span>Teatro Venezuela 24 Estados</span>
          <span>•</span>
          <span className="text-[#C46A3A] font-bold">DRONEPUNK 0.0.1</span>
        </div>
      </footer>
    </div>
  );
};

export const DronepunkLoadingScreen = GeotacticsLoadingScreen;
