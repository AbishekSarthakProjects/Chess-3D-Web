'use client';

import { useEffect, useRef, useCallback } from 'react';
import { HandLandmarker, FilesetResolver, NormalizedLandmark } from '@mediapipe/tasks-vision';

interface Props {
  onResults: (landmarks: NormalizedLandmark[]) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onError?: (error: string) => void;
}

export default function HandTracker({ onResults, videoRef, onError }: Props) {
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const runningRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);

  const detect = useCallback(() => {
    if (!runningRef.current) return;
    const video = videoRef.current;
    const handLandmarker = handLandmarkerRef.current;

    if (video && handLandmarker && video.readyState >= 2) {
      const results = handLandmarker.detectForVideo(video, performance.now());
      if (results.landmarks && results.landmarks.length > 0) {
        onResults(results.landmarks[0]);
      }
    }

    requestAnimationFrame(detect);
  }, [onResults, videoRef]);

  useEffect(() => {
    runningRef.current = true;
    let mounted = true;

    async function init() {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      if (!mounted) return;

      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
      });

      if (!mounted) return;
      handLandmarkerRef.current = handLandmarker;

      const video = videoRef.current;
      if (video) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720, facingMode: 'user' },
          });
          if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
          streamRef.current = stream;
          video.srcObject = stream;
          await video.play();
          detect();
        } catch (err) {
          onError?.('Camera access denied. Please allow camera permission and reload.');
        }
      }
    }

    init().catch((err) => {
      onError?.(`Failed to initialize hand tracking: ${err.message}`);
    });

    return () => {
      mounted = false;
      runningRef.current = false;
      // Stop all media tracks to release camera
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      try { handLandmarkerRef.current?.close(); } catch { /* ignore */ }
      handLandmarkerRef.current = null;
    };
  }, [detect, videoRef, onError]);

  return null;
}
