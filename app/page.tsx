'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { NormalizedLandmark } from '@mediapipe/tasks-vision';
import HandTracker from '@/components/HandTracker';
import { useChessInteraction } from '@/hooks/useChessInteraction';
import { getCursorState } from '@/lib/gestures';
import { CursorSmoother } from '@/lib/smoothing';
import { BOARD_PX } from '@/lib/constants';

const ChessBoard3D = dynamic(() => import('@/components/ChessBoard3D'), { ssr: false });

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const smootherRef = useRef(new CursorSmoother());
  const { state, frameRef, update, resetGame } = useChessInteraction();
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [webcamVisible, setWebcamVisible] = useState(true);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const webcamContainerRef = useRef<HTMLDivElement>(null);
  const draggingWebcam = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const moveLogRef = useRef<HTMLDivElement>(null);

  // Sound effects
  const moveSoundRef = useRef<HTMLAudioElement | null>(null);
  const captureSoundRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    moveSoundRef.current = new Audio('/sounds/piece-move.mp3');
    captureSoundRef.current = new Audio('/sounds/piece-capture.mp3');
  }, []);

  // Play sound on move
  const prevMoveCount = useRef(0);
  useEffect(() => {
    if (state.moveCount > prevMoveCount.current) {
      const sound = state.lastMoveWasCapture ? captureSoundRef.current : moveSoundRef.current;
      if (sound) { sound.currentTime = 0; sound.play().catch(() => {}); }
      prevMoveCount.current = state.moveCount;
    }
  }, [state.moveCount, state.lastMoveWasCapture]);

  // Auto-scroll move log
  useEffect(() => {
    moveLogRef.current?.scrollTo({ top: moveLogRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.moveLog.length]);

  const handleResults = useCallback(
    (landmarks: NormalizedLandmark[]) => {
      if (!isPlaying) return;
      const raw = getCursorState(landmarks, BOARD_PX, BOARD_PX, 0, 0);
      const smoothed = smootherRef.current.update(raw);
      update(smoothed);
    },
    [isPlaying, update]
  );

  const handleCameraError = useCallback((error: string) => {
    setCameraError(error);
  }, []);

  return (
    <div className="flex w-screen h-screen bg-[#050505] text-[#D8D2C8] overflow-hidden select-none">
      
      {/* ------------------------------------- */}
      {/* LEFT AREA: 3D Board & Modals          */}
      {/* ------------------------------------- */}
      <div className="flex-1 relative bg-[#050505]">
        
        {/* The 3D Scene always renders for visual context */}
        <div className={`absolute inset-0 transition-all duration-[1500ms] ease-out ${!isPlaying ? 'blur-xl scale-110 opacity-40 pointer-events-none' : 'blur-none scale-100 opacity-100'}`}>
          <ChessBoard3D state={state} frameRef={frameRef} />
        </div>

        {/* Floating Accent Orbs for premium aesthetic */}
        {!isPlaying && (
          <></>
        )}

        {/* Play Overlay (Ultra-Premium Glass Modal) */}
        {!isPlaying && (
          <div className="absolute inset-0 z-50 flex items-center justify-center">
            <div className="flex flex-col items-center gap-10 p-12 bg-[#0B0B0A]/70 backdrop-blur-3xl rounded-2xl shadow-[0_30px_100px_rgba(0,0,0,0.65)] border border-white/10 relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.08] to-transparent pointer-events-none opacity-50 transition-opacity duration-700 group-hover:opacity-100" />
              <div className="text-center relative z-10">
                <h2 className="text-7xl text-[#F3EEE6] font-normal mb-3 leading-none">Skyboard</h2>
                <p className="text-[#9E968C] font-medium text-lg">Cinematic Pass & Play</p>
              </div>
              <button 
                onClick={() => setIsPlaying(true)}
                className="relative z-10 overflow-hidden bg-[#E8E1D6] text-[#11100F] text-3xl font-normal py-4 px-16 rounded-lg shadow-[0_18px_50px_rgba(0,0,0,0.55)] transition-all duration-300 hover:bg-white hover:-translate-y-0.5 active:scale-[0.98] group/btn border border-white/30"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-[150%] skew-x-[30deg] transition-all duration-1000 ease-out group-hover/btn:translate-x-[150%]" />
                <span className="relative z-10">Engage</span>
              </button>
            </div>
          </div>
        )}

        {/* Hand Tracking (Only enabled while playing) */}
        {isPlaying && (
          <HandTracker onResults={handleResults} videoRef={videoRef} onError={handleCameraError} />
        )}

        {/* Draggable Webcam Picture-in-Picture */}
        {isPlaying && (
          <div
            ref={webcamContainerRef}
            className="fixed z-[60] cursor-grab active:cursor-grabbing shadow-[0_20px_40px_rgba(0,0,0,0.5)] rounded-xl"
            style={{ left: 24, bottom: 24 }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              draggingWebcam.current = true;
              const rect = e.currentTarget.getBoundingClientRect();
              dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!draggingWebcam.current || !webcamContainerRef.current) return;
              const el = webcamContainerRef.current;
              // Hard boundary to prevent crossing into sidebar
              const sidebarWidth = 384; // w-96
              const maxX = window.innerWidth - sidebarWidth - el.offsetWidth - 24;
              const x = Math.max(24, Math.min(e.clientX - dragOffset.current.x, maxX));
              el.style.left = `${x}px`;
              el.style.bottom = `${Math.max(24, window.innerHeight - e.clientY - (el.offsetHeight - dragOffset.current.y))}px`;
            }}
            onPointerUp={() => { draggingWebcam.current = false; }}
          >
            <div className={`bg-[#121212]/80 backdrop-blur-md border border-white/5 rounded-xl overflow-hidden transition-all duration-500 ease-in-out ${webcamVisible ? 'w-56 h-40 opacity-100' : 'w-0 h-0 opacity-0 border-none'}`}>
              <video
                ref={videoRef}
                className="w-full h-full object-cover pointer-events-none mix-blend-screen opacity-80"
                style={{ transform: 'scaleX(-1)' }}
                playsInline
                muted
              />
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setWebcamVisible(v => !v); }}
              className={`absolute -top-3 -right-3 w-8 h-8 rounded-full bg-[#1A1A1A] border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-[#2A2A2A] transition-all cursor-pointer shadow-lg z-10 ${webcamVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-0 pointer-events-none'}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            {!webcamVisible && (
               <button
                 onClick={(e) => { e.stopPropagation(); setWebcamVisible(v => !v); }}
                 className="flex items-center justify-center bg-[#1A1A1A]/80 backdrop-blur backdrop-saturate-150 border border-white/10 rounded-xl p-3 text-zinc-400 hover:text-white transition-colors cursor-pointer w-full mt-2 shadow-lg"
               >
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                 </svg>
               </button>
            )}
          </div>
        )}

        {/* Camera error generic popup */}
        {cameraError && (
          <div className="absolute inset-0 flex items-center justify-center z-[100] bg-black/60 backdrop-blur-sm">
            <div className="text-center p-8 bg-[#080807] border border-red-500/20 rounded-2xl max-w-sm shadow-[0_0_50px_rgba(239,68,68,0.15)] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-rose-400" />
              <div className="text-red-400 text-xl font-bold mb-3 tracking-wide">Camera Error</div>
              <div className="text-zinc-400 text-sm leading-relaxed">{cameraError}</div>
              <button 
                onClick={() => setCameraError(null)} 
                className="mt-6 w-full py-3 bg-white/5 hover:bg-white/10 rounded-lg text-white font-medium transition-colors border border-white/5"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Game over modal */}
        {state.gameOver && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="bg-[#080807] border border-white/10 rounded-2xl p-10 text-center shadow-[0_20px_60px_rgba(0,0,0,0.8)] relative overflow-hidden">
              <div className="relative z-10 text-6xl text-[#F3EEE6] font-normal mb-4 leading-none">
                {state.gameOver === 'checkmate' ? (state.turn === 'white' ? 'Black wins!' : 'White wins!') : 'Draw'}
              </div>
              <div className="relative z-10 text-[#BDB5AA] text-lg font-normal mb-10">
                {state.gameOver === 'checkmate' ? 'by Checkmate' : state.gameOver === 'stalemate' ? 'by Stalemate' : 'by Draw'}
              </div>
              <button
                onClick={resetGame}
                className="relative z-10 bg-[#312E2B] border border-white/10 hover:border-white/30 font-medium text-white px-10 py-4 rounded-xl transition-all w-full text-lg shadow-lg hover:bg-[#3D3A37] active:scale-95"
              >
                Rematch
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------- */}
      {/* RIGHT SIDEBAR (Premium Aesthetic)     */}
      {/* ------------------------------------- */}
      <div className="w-96 flex-shrink-0 bg-[#070707] flex flex-col border-l border-white/10 shadow-2xl relative z-40">
        
        {/* Header */}
        <div className="px-6 py-6 border-b border-white/10 flex items-center gap-4 bg-white/[0.015]">
          <div className="w-10 h-10 bg-[#E8E1D6] rounded-lg shadow-[0_2px_10px_rgba(0,0,0,0.35)] flex items-center justify-center p-2.5 border border-white/20">
            <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="#11100F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 14c-3 0-5.5-.5-8-1.55l-1 5.55h11l-2-4z"/><path d="M15 9V4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v5c0 1.5-1.5 3-3 4v3h12v-3c-1.5-1-3-2.5-3-4z"/></svg>
          </div>
          <div>
            <h1 className="text-4xl text-[#F3EEE6] font-normal leading-none">Skyboard</h1>
            <p className="text-sm text-[#8F877D] font-normal mt-1">Pass & Play</p>
          </div>
        </div>
        
        {/* Opposing Player Bento Box */}
        <div className="p-4 px-6 border-b border-white/5">
           <div className={`p-4 rounded-xl border transition-all duration-500 ${state.turn !== 'white' ? 'bg-white/[0.04] border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.5)]' : 'bg-transparent border-transparent opacity-60'}`}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-zinc-900 rounded-lg flex items-center justify-center text-xl border border-white/5 text-zinc-600 font-bold shadow-inner relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                {state.turn === 'white' ? 'B' : 'W'}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-zinc-200 tracking-wide text-lg flex items-center justify-between">
                   {state.turn === 'white' ? 'Black' : 'White'}
                   {state.turn !== 'white' && <span className="w-2 h-2 rounded-full bg-[#E8E1D6]" />}
                </div>
                <div className="text-[11px] text-zinc-500 tracking-wider uppercase font-medium mt-0.5">Opponent</div>
              </div>
            </div>
          </div>
        </div>

        {/* Global Game Status */}
        {state.isCheck && (
          <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex justify-center items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <div className="text-[11px] tracking-[0.2em] uppercase font-bold text-red-400">King in Check</div>
          </div>
        )}

        {/* Move Log Bento Box */}
        <div className="flex-1 flex flex-col mx-6 my-4 bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden relative shadow-inner">
           <div className="px-4 py-3 border-b border-white/5 bg-white/[0.01]">
              <div className="text-[10px] uppercase text-zinc-500 font-bold tracking-[0.15em]">Match Ledger</div>
           </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 custom-scrollbar">
            <div className="space-y-1" ref={moveLogRef}>
              {Array.from({ length: Math.ceil(state.moveLog.length / 2) }, (_, i) => (
                <div key={`move-${i}`} className={`flex rounded-lg overflow-hidden transition-colors ${i % 2 === 0 ? 'bg-white/[0.03]' : ''} hover:bg-white/[0.06]`}>
                  <div className="w-10 bg-white/[0.02] text-zinc-500 text-center py-2 text-xs font-semibold border-r border-white/5 flex items-center justify-center">
                    {i + 1}
                  </div>
                  <div className="flex-1 flex text-zinc-300 font-mono text-sm">
                    <div className="flex-1 pl-4 py-2 opacity-80 mix-blend-screen">{state.moveLog[i * 2]}</div>
                    <div className="flex-1 pl-4 py-2 opacity-80 mix-blend-screen">{state.moveLog[i * 2 + 1] || ''}</div>
                  </div>
                </div>
              ))}
              <div className="h-4" />
            </div>
          </div>
        </div>

        {/* Current Player Bento Box */}
        <div className="p-4 px-6 border-t border-white/10 bg-[#070707]">
          <div className={`p-4 rounded-xl border transition-all duration-500 ${state.turn === 'white' ? 'bg-white/[0.055] border-white/15 shadow-none' : 'bg-transparent border-transparent opacity-60'}`}>
            <div className="flex items-center gap-4 flex-row-reverse">
              <div className="w-12 h-12 bg-[#E8E1D6] rounded-lg flex items-center justify-center text-2xl text-[#11100F] font-normal shadow-lg relative overflow-hidden border border-white/30">
                <div className="absolute inset-0 bg-gradient-to-b from-white/35 to-transparent pointer-events-none" />
                {state.turn === 'white' ? 'W' : 'B'}
              </div>
              <div className="flex-1 text-right">
                <div className="font-normal text-white text-2xl flex items-center justify-end gap-3">
                   {state.turn === 'white' && <span className="w-2 h-2 rounded-full bg-[#E8E1D6]" />}
                   {state.turn === 'white' ? 'White' : 'Black'}
                </div>
                <div className="text-base text-[#BDB5AA] font-normal mt-0.5">Your Turn</div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Area (Footer) */}
        <div className="px-6 py-6 bg-[#070707] border-t border-white/10 flex gap-3 relative z-10">
          <button 
            onClick={resetGame}
            className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-zinc-200 font-medium tracking-wide rounded-xl transition-all shadow-lg active:scale-[0.98]"
          >
            New Game
          </button>
          <button 
            onClick={() => setShowHowItWorks(true)}
            className="w-14 flex items-center justify-center bg-transparent border border-white/10 hover:bg-white/5 hover:border-white/20 text-zinc-400 hover:text-white rounded-xl transition-all shadow-lg active:scale-[0.98]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
            </svg>
          </button>
        </div>

      </div>

      {/* High-End Glassmorphic How It Works Modal */}
        {showHowItWorks && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl" 
          onClick={() => setShowHowItWorks(false)}
        >
          <div 
            className="bg-[#080807] border border-white/10 rounded-2xl p-10 max-w-xl mx-4 text-left shadow-[0_0_100px_rgba(0,0,0,0.8)] relative overflow-hidden" 
            onClick={e => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-[#E8E1D6] to-transparent" />
            
            <div className="flex justify-between items-start mb-8 relative z-10">
              <h2 className="text-5xl text-[#F3EEE6] font-normal leading-none">System Architecture</h2>
              <button onClick={() => setShowHowItWorks(false)} className="text-zinc-600 hover:text-white transition-colors bg-white/5 hover:bg-white/10 rounded-full p-2 border border-transparent hover:border-white/10">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            
            <div className="flex flex-col gap-8 text-sm text-zinc-400 leading-relaxed font-medium relative z-10">
              <div className="flex gap-4">
                <div className="mt-1 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 text-zinc-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>
                </div>
                <div>
                  <div className="text-zinc-200 text-sm font-bold tracking-wide uppercase mb-1 flex items-center gap-2">Spatial Interaction</div>
                  <div>MediaPipe detects physical hand landmarks via webcam. Pinch empty space to grab, drag across the board, and release to manipulate pieces.</div>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="mt-1 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 text-zinc-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                </div>
                <div>
                  <div className="text-zinc-200 text-sm font-bold tracking-wide uppercase mb-1">Flick Physics</div>
                  <div>If a piece is dropped on an invalid target but dragged accurately toward a legal vector, the physics engine will auto-flick the piece into place.</div>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="mt-1 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 text-zinc-300">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                </div>
                <div>
                  <div className="text-zinc-200 text-sm font-bold tracking-wide uppercase mb-1">Cinematic Rotation</div>
                  <div>Upon move completion, the 3D camera rig smoothly orbits 180° around the Y-axis, passing the turn to the opposing player instantly.</div>
                </div>
              </div>
            </div>
            
            <div className="mt-10 pt-6 border-t border-zinc-800 flex justify-between items-center relative z-10">
              <div className="text-xs text-zinc-600 font-mono tracking-widest">
                NEXT.JS // THREE.JS // MEDIAPIPE
              </div>
              <button 
                onClick={() => setShowHowItWorks(false)}
                className="px-6 py-2 bg-[#E8E1D6] hover:bg-white text-[#11100F] border border-white/20 font-normal rounded-lg transition-colors text-lg"
              >
                Close Protocol
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
