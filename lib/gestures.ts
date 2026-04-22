import { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { BOARD_PX, SQUARE_SIZE } from './constants';

export interface CursorState {
  x: number;
  y: number;
  pinching: boolean;
  pinchDistance: number; // raw normalized distance for smoother
}

function distance2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function distance3D(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.sqrt(
    (a.x - b.x) ** 2 +
    (a.y - b.y) ** 2 +
    ((a.z ?? 0) - (b.z ?? 0)) ** 2
  );
}

// Map a small central region of the camera to the full board.
// Less hand movement = full board coverage. The Y range is shifted
// upward so you don't need to lower your hand to reach bottom pieces.
const TRACK_PAD_X = 0.20; // ignore outer 20% on each side horizontally
const TRACK_TOP = 0.15;   // ignore top 15%
const TRACK_BOTTOM = 0.35; // ignore bottom 35% — shifted up so bottom pieces are reachable

export function getCursorPosition(
  landmarks: NormalizedLandmark[],
  canvasWidth: number,
  canvasHeight: number,
  boardOffsetX: number,
  boardOffsetY: number,
): { x: number; y: number } {
  const indexTip = landmarks[8];
  const indexDip = landmarks[7];

  // Weighted blend: 70% tip, 30% DIP for stability
  const rawX = indexTip.x * 0.7 + indexDip.x * 0.3;
  const rawY = indexTip.y * 0.7 + indexDip.y * 0.3;

  // Remap from [PAD, 1-PAD] to [0, 1]
  // X: symmetric padding. Y: asymmetric — shifted up so bottom rows are easy to reach
  const nx = Math.max(0, Math.min(1, (rawX - TRACK_PAD_X) / (1 - 2 * TRACK_PAD_X)));
  const ny = Math.max(0, Math.min(1, (rawY - TRACK_TOP) / (1 - TRACK_TOP - TRACK_BOTTOM)));

  // Mirror x for natural feel
  const x = (1 - nx) * canvasWidth - boardOffsetX;
  const y = ny * canvasHeight - boardOffsetY;
  return { x, y };
}

export function getPinchDistance(landmarks: NormalizedLandmark[]): number {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  return distance3D(thumbTip, indexTip);
}

export function getSquare(
  x: number,
  y: number,
  turn: 'white' | 'black' = 'white'
): { row: number; col: number } | null {
  if (x < 0 || y < 0 || x >= BOARD_PX || y >= BOARD_PX) return null;
  const rawRow = Math.floor(y / SQUARE_SIZE);
  const rawCol = Math.floor(x / SQUARE_SIZE);
  if (turn === 'white') {
    return { row: rawRow, col: rawCol };
  } else {
    return { row: 7 - rawRow, col: 7 - rawCol };
  }
}

// Helper to get raw screen pixel position of a square's center, respecting board rotation
function getSquarePixelPos(row: number, col: number, turn: 'white' | 'black') {
  if (turn === 'white') {
    return { x: (col + 0.5) * SQUARE_SIZE, y: (row + 0.5) * SQUARE_SIZE };
  } else {
    return { x: (7 - col + 0.5) * SQUARE_SIZE, y: (7 - row + 0.5) * SQUARE_SIZE };
  }
}

// Find the best legal square based on flick direction from origin
export function getFlickTarget(
  fromRow: number,
  fromCol: number,
  curX: number,
  curY: number,
  legalSquares: Set<string>,
  turn: 'white' | 'black' = 'white'
): { row: number; col: number } | null {
  // Direction vector from origin to current position (in pixel space)
  const origin = getSquarePixelPos(fromRow, fromCol, turn);
  const dx = curX - origin.x;
  const dy = curY - origin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Need at least half a square of movement, but NOT too far (max 2.5 squares)
  // If you dragged far to an illegal square, it's not a flick — it's a miss
  if (dist < SQUARE_SIZE * 0.4 || dist > SQUARE_SIZE * 2.5) return null;

  // Normalize direction
  const nx = dx / dist;
  const ny = dy / dist;

  let best: { row: number; col: number } | null = null;
  let bestScore = -1;

  for (const key of legalSquares) {
    const [row, col] = key.split(',').map(Number);
    const sqPos = getSquarePixelPos(row, col, turn);
    const sdx = sqPos.x - origin.x;
    const sdy = sqPos.y - origin.y;
    const sDist = Math.sqrt(sdx * sdx + sdy * sdy);
    if (sDist === 0) continue;

    // The cursor must be NEAR the legal square (within 1.5 squares) — no long-range guessing
    const curDist = Math.sqrt((curX - sqPos.x) ** 2 + (curY - sqPos.y) ** 2);
    if (curDist > SQUARE_SIZE * 1.5) continue;

    // Dot product = how aligned is this square with the flick direction
    const dot = (sdx / sDist) * nx + (sdy / sDist) * ny;

    // Must be at least roughly in the same direction (> 0.6 = within ~53 degrees)
    if (dot > 0.6 && dot > bestScore) {
      bestScore = dot;
      best = { row, col };
    }
  }

  return best;
}

export function getCursorState(
  landmarks: NormalizedLandmark[],
  canvasWidth: number,
  canvasHeight: number,
  boardOffsetX: number,
  boardOffsetY: number,
): CursorState {
  const pos = getCursorPosition(landmarks, canvasWidth, canvasHeight, boardOffsetX, boardOffsetY);
  const pinchDist = getPinchDistance(landmarks);
  return {
    ...pos,
    pinching: pinchDist < 0.045, // raw threshold, smoother will handle hysteresis
    pinchDistance: pinchDist,
  };
}
