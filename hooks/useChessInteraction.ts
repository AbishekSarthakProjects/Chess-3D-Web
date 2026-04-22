import { useCallback, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Board, Piece, PIECE_TYPE_MAP } from '@/lib/chess';
import { CursorState, getSquare, getFlickTarget } from '@/lib/gestures';
import { GRAB_DEBOUNCE_MS } from '@/lib/constants';

export interface DragState {
  piece: Piece;
  fromRow: number;
  fromCol: number;
  fromSquare: Square;
  x: number;
  y: number;
}

export interface FrameData {
  cursorX: number;
  cursorY: number;
  hoveredRow: number;
  hoveredCol: number;
  hoverValid: boolean;
  dragging: DragState | null;
  legalSquares: Set<string>;
  pinching: boolean;
  pinchDistance: number;
  turn: 'white' | 'black';
}

export interface InteractionState {
  board: Board;
  lastMove: { from: { row: number; col: number }; to: { row: number; col: number } } | null;
  isCheck: boolean;
  turn: 'white' | 'black';
  gameOver: string | null;
  thinking: boolean;
  draggingPiece: Piece | null;
  selectedSquare: { row: number; col: number } | null;
  capturedByWhite: Piece[];
  capturedByBlack: Piece[];
  moveLog: string[];
  lastMoveWasCapture: boolean;
  moveCount: number; // increments on each move, used to trigger effects
}

function toSquare(row: number, col: number): Square {
  const file = String.fromCharCode(97 + col);
  const rank = String(8 - row);
  return `${file}${rank}` as Square;
}

function fromSquare(sq: Square): { row: number; col: number } {
  const col = sq.charCodeAt(0) - 97;
  const row = 8 - parseInt(sq[1]);
  return { row, col };
}

function chessToBoardArray(chess: Chess): Board {
  const board: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = chess.get(toSquare(row, col));
      if (piece) {
        board[row][col] = {
          type: PIECE_TYPE_MAP[piece.type],
          color: piece.color === 'w' ? 'white' : 'black',
        };
      }
    }
  }
  return board;
}

function getCapturedPieces(chess: Chess): { capturedByWhite: Piece[]; capturedByBlack: Piece[] } {
  const capturedByWhite: Piece[] = [];
  const capturedByBlack: Piece[] = [];
  for (const move of chess.history({ verbose: true })) {
    if (move.captured) {
      const capturedPiece: Piece = {
        type: PIECE_TYPE_MAP[move.captured],
        color: move.color === 'w' ? 'black' : 'white',
      };
      if (move.color === 'w') capturedByWhite.push(capturedPiece);
      else capturedByBlack.push(capturedPiece);
    }
  }
  return { capturedByWhite, capturedByBlack };
}

// AI logic removed as part of local 2-player transition.

export function useChessInteraction() {
  const chessRef = useRef(new Chess());
  const [reactState, setReactState] = useState<InteractionState>(() => ({
    board: chessToBoardArray(chessRef.current),
    lastMove: null,
    isCheck: false,
    turn: 'white',
    gameOver: null,
    thinking: false,
    draggingPiece: null,
    selectedSquare: null,
    capturedByWhite: [],
    capturedByBlack: [],
    moveLog: [],
    lastMoveWasCapture: false,
    moveCount: 0,
  }));

  const frameRef = useRef<FrameData>({
    cursorX: 0, cursorY: 0,
    hoveredRow: -1, hoveredCol: -1, hoverValid: false,
    dragging: null,
    legalSquares: new Set(),
    pinching: false,
    pinchDistance: 0,
    turn: 'white',
  });

  const wasPinchingRef = useRef(false);
  const lastPinchChangeRef = useRef(0);
  const lastMoveRef = useRef<InteractionState['lastMove']>(null);
  const moveHistoryRef = useRef<string[]>([]);

  const moveCountRef = useRef(0);

  const syncReactState = useCallback((
    lastMove?: InteractionState['lastMove'],
    thinking = false,
    wasCapture = false,
  ) => {
    if (lastMove !== undefined) lastMoveRef.current = lastMove;
    if (lastMove) moveCountRef.current++;
    const chess = chessRef.current;
    setReactState({
      board: chessToBoardArray(chess),
      lastMove: lastMoveRef.current,
      isCheck: chess.isCheck(),
      turn: chess.turn() === 'w' ? 'white' : 'black',
      gameOver: chess.isCheckmate() ? 'checkmate'
        : chess.isStalemate() ? 'stalemate'
        : chess.isDraw() ? 'draw'
        : null,
      thinking,
      draggingPiece: null,
      selectedSquare: null,
      ...getCapturedPieces(chess),
      moveLog: chess.history(),
      lastMoveWasCapture: wasCapture,
      moveCount: moveCountRef.current,
    });
  }, []);

  // requestAIMove removed for local 2-player

  const update = useCallback((cursor: CursorState) => {
    const f = frameRef.current;
    f.cursorX = cursor.x;
    f.cursorY = cursor.y;
    f.pinching = cursor.pinching;
    f.pinchDistance = cursor.pinchDistance;

    f.turn = chessRef.current.turn() === 'w' ? 'white' : 'black';
    const square = getSquare(cursor.x, cursor.y, f.turn);
    f.hoveredRow = square?.row ?? -1;
    f.hoveredCol = square?.col ?? -1;
    f.hoverValid = square !== null;

    if (chessRef.current.isGameOver()) return;

    const now = Date.now();
    const pinchChanged = cursor.pinching !== wasPinchingRef.current;
    const debounceOk = now - lastPinchChangeRef.current > GRAB_DEBOUNCE_MS;

    if (pinchChanged && debounceOk) {
      lastPinchChangeRef.current = now;
      wasPinchingRef.current = cursor.pinching;

      if (cursor.pinching && !f.dragging) {
        // --- GRAB ---
        if (!square) return;
        const chess = chessRef.current;
        const sq = toSquare(square.row, square.col);
        const piece = chess.get(sq);
        // Ensure player only grabs their own color
        if (!piece || (f.turn === 'white' && piece.color !== 'w') || (f.turn === 'black' && piece.color !== 'b')) return;

        const moves = chess.moves({ square: sq, verbose: true });
        const legal = new Set(moves.map(m => {
          const s = fromSquare(m.to as Square);
          return `${s.row},${s.col}`;
        }));

        f.legalSquares = legal;
        f.dragging = {
          piece: { type: PIECE_TYPE_MAP[piece.type], color: f.turn },
          fromRow: square.row,
          fromCol: square.col,
          fromSquare: sq,
          x: cursor.x,
          y: cursor.y,
        };

        setReactState(prev => {
          const newBoard = prev.board.map(r => [...r]);
          newBoard[square.row][square.col] = null;
          return {
            ...prev,
            board: newBoard,
            draggingPiece: { type: PIECE_TYPE_MAP[piece.type], color: f.turn as 'white'|'black' },
          };
        });
      } else if (!cursor.pinching && f.dragging) {
        // --- DROP ---
        const drag = f.dragging;
        let moved = false;
        const dropSquare = getSquare(drag.x, drag.y, f.turn);

        const isCancel = dropSquare && dropSquare.row === drag.fromRow && dropSquare.col === drag.fromCol;

        if (!isCancel) {
          // 1. Try exact square
          if (dropSquare) {
            const toSq = toSquare(dropSquare.row, dropSquare.col);
            try {
              const move = chessRef.current.move({ from: drag.fromSquare, to: toSq, promotion: 'q' });
              if (move) {
                moved = true;
                moveHistoryRef.current.push(`${drag.fromSquare}${toSq}`);
                syncReactState({ from: { row: drag.fromRow, col: drag.fromCol }, to: dropSquare }, false, !!move.captured);
              }
            } catch { /* illegal */ }
          }

          // 2. Exact square was illegal — try flick
          if (!moved) {
            const flickTarget = getFlickTarget(drag.fromRow, drag.fromCol, drag.x, drag.y, f.legalSquares, f.turn);
            if (flickTarget) {
              const toSq = toSquare(flickTarget.row, flickTarget.col);
              try {
                const move = chessRef.current.move({ from: drag.fromSquare, to: toSq, promotion: 'q' });
                if (move) {
                  moved = true;
                  moveHistoryRef.current.push(`${drag.fromSquare}${toSq}`);
                  syncReactState({ from: { row: drag.fromRow, col: drag.fromCol }, to: flickTarget }, false, !!move.captured);
                }
              } catch { /* illegal */ }
            }
          }
        }

        if (!moved) {
          syncReactState();
        }

        f.dragging = null;
        f.legalSquares = new Set();
      }
    } else if (cursor.pinching && f.dragging) {
      f.dragging = { ...f.dragging, x: cursor.x, y: cursor.y };
      const dragSquare = getSquare(cursor.x, cursor.y, f.turn);
      f.hoveredRow = dragSquare?.row ?? -1;
      f.hoveredCol = dragSquare?.col ?? -1;
      f.hoverValid = dragSquare !== null;
    }
  }, [syncReactState]);

  const resetGame = useCallback(() => {
    chessRef.current = new Chess();
    moveHistoryRef.current = [];
    moveCountRef.current = 0;
    lastMoveRef.current = null;
    frameRef.current.dragging = null;
    frameRef.current.legalSquares = new Set();
    syncReactState();
  }, [syncReactState]);

  return { state: reactState, frameRef, update, resetGame };
}
