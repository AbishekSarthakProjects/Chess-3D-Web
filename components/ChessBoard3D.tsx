'use client';

import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, ContactShadows, useGLTF, Environment, MeshReflectorMaterial } from '@react-three/drei';
import { InteractionState, FrameData } from '@/hooks/useChessInteraction';
import { Piece, PieceType } from '@/lib/chess';
import { BOARD_SIZE, SQUARE_SIZE } from '@/lib/constants';
import * as THREE from 'three';
import { useMemo, useRef, Suspense, MutableRefObject } from 'react';

// --- Layout constants ---
const SQ = 1; // 1 world unit per square
const HALF = (BOARD_SIZE * SQ) / 2;
const SURFACE_Y = 0.31;
const CURSOR_Y = 0.32;
const TILE_Y = 0.25;
const DRAG_LIFT = 0.8;

// --- B&W minimal palette ---
const LIGHT_TILE = '#E0E0E0';
const DARK_TILE = '#1A1A1A';
const HIGHLIGHT_COLOR = '#555555';
const GRAB_COLOR = '#777777';
const LEGAL_MOVE_COLOR = '#D8D2C8';
const LEGAL_CAPTURE_COLOR = '#8b3a3a';
const LAST_MOVE_COLOR = '#B7B1A8';
const WHITE_PIECE = '#EEEED2';
const BLACK_PIECE = '#444444';
const BOARD_FRAME_COLOR = '#0A0A0A';

// --- Model configs from chess3d ---
const MODEL_CONFIG: Record<PieceType, {
  path: string;
  scale: [number, number, number];
  y: number;
  rotation?: [number, number, number];
  centerGeometry?: boolean;
}> = {
  pawn:   { path: '/models/pawn/scene.gltf',   scale: [0.2, 0.2, 0.2],    y: 0.7,  centerGeometry: true },
  rook:   { path: '/models/rook/scene.gltf',   scale: [0.7, 0.7, 0.7],    y: 0.8,  rotation: [-Math.PI / 2, 0, 0], centerGeometry: true },
  knight: { path: '/models/knight/scene.gltf',  scale: [0.35, 0.35, 0.35], y: 0.88, centerGeometry: true },
  bishop: { path: '/models/bishop/scene.gltf',  scale: [20, 20, 20],       y: 0.88, centerGeometry: true },
  queen:  { path: '/models/queen/scene.gltf',   scale: [0.12, 0.12, 0.12], y: 0.3 },
  king:   { path: '/models/king/scene.gltf',    scale: [16, 16, 16],       y: 0.8 },
};

Object.values(MODEL_CONFIG).forEach(c => useGLTF.preload(c.path));

// --- Shared utilities ---

function toWorld(row: number, col: number): [number, number, number] {
  return [col * SQ - HALF + SQ / 2, 0, row * SQ - HALF + SQ / 2];
}

function pixToWorld(px: number, py: number, turn: 'white' | 'black' = 'white'): { x: number; z: number } {
  if (turn === 'white') {
    return {
      x: (px / SQUARE_SIZE) * SQ - HALF,
      z: (py / SQUARE_SIZE) * SQ - HALF,
    };
  } else {
    return {
      x: HALF - (px / SQUARE_SIZE) * SQ,
      z: HALF - (py / SQUARE_SIZE) * SQ,
    };
  }
}

function worldToSquare(wx: number, wz: number): { row: number; col: number } | null {
  const col = Math.floor((wx + HALF) / SQ);
  const row = Math.floor((wz + HALF) / SQ);
  if (col < 0 || col >= 8 || row < 0 || row >= 8) return null;
  return { row, col };
}

function getRotation(type: PieceType, color: string): [number, number, number] {
  if (type === 'knight') return [-Math.PI / 2, 0, color === 'black' ? Math.PI / 2 : -Math.PI / 2];
  return MODEL_CONFIG[type].rotation ?? [0, 0, 0];
}

function clonePieceScene(
  scene: THREE.Group,
  piece: { type: PieceType; color: string },
  opts?: { transparent?: boolean; opacity?: number },
): THREE.Group {
  const config = MODEL_CONFIG[piece.type];
  const clone = scene.clone(true);
  const matColor = piece.color === 'white' ? WHITE_PIECE : BLACK_PIECE;

  clone.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.material = new THREE.MeshStandardMaterial({
      color: matColor,
      metalness: 0.1,
      roughness: 0.5,
      ...(opts?.transparent ? { transparent: true, opacity: opts.opacity ?? 1 } : {}),
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (config.centerGeometry && mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      mesh.geometry.boundingBox!.getCenter(center);
      mesh.geometry.translate(-center.x, -center.y, -center.z);
    }
  });

  return clone;
}

// --- Components ---

function PieceModel({ piece, row, col, frameRef }: {
  piece: Piece; row: number; col: number;
  frameRef?: MutableRefObject<FrameData>;
}) {
  const config = MODEL_CONFIG[piece.type];
  const { scene } = useGLTF(config.path);
  const cloned = useMemo(() => clonePieceScene(scene, piece), [scene, piece.color, piece.type]);
  const [bx, , bz] = toWorld(row, col);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const group = groupRef.current;
    if (!group || !frameRef) return;
    const f = frameRef.current;

    if (!f.dragging) {
      // Smooth return to neutral
      group.position.x *= 0.9;
      group.position.z *= 0.9;
      group.rotation.x *= 0.9;
      group.rotation.z *= 0.9;
      return;
    }

    // Only push ENEMY pieces that are capturable (in legalSquares)
    const key = `${row},${col}`;
    const isEnemy = piece.color !== f.dragging.piece.color;
    const isCapturable = isEnemy && f.legalSquares.has(key);

    if (!isCapturable) {
      group.position.x *= 0.9;
      group.position.z *= 0.9;
      group.rotation.x *= 0.9;
      group.rotation.z *= 0.9;
      return;
    }

    // Distance from dragged piece to this piece
    const dragWorld = pixToWorld(f.dragging.x, f.dragging.y, f.turn);
    const dx = bx - dragWorld.x;
    const dz = bz - dragWorld.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Push when dragged piece enters the square
    const pushRadius = 0.7;
    if (dist < pushRadius && dist > 0.01) {
      const strength = (1 - dist / pushRadius);
      const nx = dx / dist;
      const nz = dz / dist;
      // Slide away horizontally only
      const targetX = nx * strength * 0.4;
      const targetZ = nz * strength * 0.4;
      group.position.x += (targetX - group.position.x) * 0.3;
      group.position.z += (targetZ - group.position.z) * 0.3;
    } else {
      group.position.x *= 0.85;
      group.position.z *= 0.85;
    }
    // Never affect vertical or rotation
    group.position.y = 0;
    group.rotation.x = 0;
    group.rotation.z = 0;
  });

  return (
    <group ref={groupRef}>
      <primitive
        object={cloned}
        position={[bx, config.y, bz]}
        scale={config.scale}
        rotation={getRotation(piece.type, piece.color)}
      />
    </group>
  );
}

function DraggedPieceInner({ piece, frameRef }: {
  piece: Piece;
  frameRef: MutableRefObject<FrameData>;
}) {
  const config = MODEL_CONFIG[piece.type];
  const { scene } = useGLTF(config.path);
  const cloned = useMemo(() => clonePieceScene(scene, piece), [scene, piece.color, piece.type]);
  const groupRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);
  const smoothPos = useRef({ x: 0, z: 0 });
  const velocity = useRef({ x: 0, z: 0 });
  const initialized = useRef(false);

  useFrame(() => {
    const group = groupRef.current;
    const inner = innerRef.current;
    if (!group || !inner) return;
    const f = frameRef.current;
    if (!f.dragging) {
      group.visible = false;
      initialized.current = false;
      return;
    }
    group.visible = true;
    const target = pixToWorld(f.dragging.x, f.dragging.y, f.turn);

    if (!initialized.current) {
      smoothPos.current = { x: target.x, z: target.z };
      velocity.current = { x: 0, z: 0 };
      initialized.current = true;
    }

    // Smooth follow with inertia (lerp)
    const lerp = 0.18;
    const prevX = smoothPos.current.x;
    const prevZ = smoothPos.current.z;
    smoothPos.current.x += (target.x - smoothPos.current.x) * lerp;
    smoothPos.current.z += (target.z - smoothPos.current.z) * lerp;

    // Track velocity for tilt
    velocity.current.x = smoothPos.current.x - prevX;
    velocity.current.z = smoothPos.current.z - prevZ;

    group.position.set(smoothPos.current.x, config.y + DRAG_LIFT, smoothPos.current.z);

    // Tilt based on velocity — piece leans into the direction of movement
    const tiltStrength = 3.0;
    const maxTilt = 0.25;
    const tiltX = Math.max(-maxTilt, Math.min(maxTilt, velocity.current.z * tiltStrength));
    const tiltZ = Math.max(-maxTilt, Math.min(maxTilt, -velocity.current.x * tiltStrength));
    inner.rotation.x = tiltX;
    inner.rotation.z = tiltZ;
  });

  return (
    <group ref={groupRef}>
      <group ref={innerRef}>
        <primitive object={cloned} scale={config.scale} rotation={getRotation(piece.type, piece.color)} />
      </group>
    </group>
  );
}

function DraggedPiece({ frameRef, draggingPiece }: {
  frameRef: MutableRefObject<FrameData>;
  draggingPiece: Piece | null;
}) {
  if (!draggingPiece) return null;
  return <DraggedPieceInner piece={draggingPiece} frameRef={frameRef} />;
}

function Cursor({ frameRef }: { frameRef: MutableRefObject<FrameData> }) {
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const dotRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    const dot = dotRef.current;
    if (!outer || !inner || !dot) return;
    const f = frameRef.current;
    const { x, z } = pixToWorld(f.cursorX, f.cursorY, f.turn);
    const y = f.dragging ? CURSOR_Y + DRAG_LIFT + 0.5 : CURSOR_Y;
    outer.position.set(x, y, z);
    inner.position.set(x, y, z);
    dot.position.set(x, y, z);
    // Pulse when dragging
    const s = f.dragging ? 1.0 + Math.sin(Date.now() * 0.006) * 0.1 : 1.0;
    outer.scale.set(s, s, 1);
  });

  return (
    <>
      {/* Dark outer ring — visible on light surfaces */}
      <mesh ref={outerRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.09, 0.12, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.5} />
      </mesh>
      {/* Bright inner ring — visible on dark surfaces */}
      <mesh ref={innerRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.07, 0.09, 32]} />
        <meshBasicMaterial color="#FFFFFF" transparent opacity={0.6} />
      </mesh>
      {/* Center dot */}
      <mesh ref={dotRef} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.02, 16]} />
        <meshBasicMaterial color="#FF6633" transparent opacity={0.9} />
      </mesh>
    </>
  );
}

function HoverHighlight({ frameRef, board }: { frameRef: MutableRefObject<FrameData>; board: (Piece | null)[][] }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const f = frameRef.current;
    const cursorWorld = pixToWorld(
      f.dragging ? f.dragging.x : f.cursorX,
      f.dragging ? f.dragging.y : f.cursorY,
      f.turn
    );
    const sq = worldToSquare(cursorWorld.x, cursorWorld.z);
    if (!sq) { mesh.visible = false; return; }

    // Hide hover on the origin square while dragging (ghost marker is already there)
    if (f.dragging && sq.row === f.dragging.fromRow && sq.col === f.dragging.fromCol) {
      mesh.visible = false;
      return;
    }

    mesh.visible = true;
    const [x, , z] = toWorld(sq.row, sq.col);
    mesh.position.set(x, SURFACE_Y, z);

    if (f.dragging) {
      const key = `${sq.row},${sq.col}`;
      const isLegal = f.legalSquares.has(key);
      const hasPiece = board[sq.row]?.[sq.col] !== null;
      if (isLegal && hasPiece) {
        (mesh.material as THREE.MeshBasicMaterial).color.set(LEGAL_CAPTURE_COLOR);
      } else if (isLegal) {
        (mesh.material as THREE.MeshBasicMaterial).color.set(LEGAL_MOVE_COLOR);
      } else {
        (mesh.material as THREE.MeshBasicMaterial).color.set(GRAB_COLOR);
      }
    } else {
      (mesh.material as THREE.MeshBasicMaterial).color.set(HIGHLIGHT_COLOR);
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[SQ, 0.02, SQ]} />
      <meshBasicMaterial color={HIGHLIGHT_COLOR} transparent opacity={0.6} />
    </mesh>
  );
}

function LegalMoveDots({ frameRef, board }: { frameRef: MutableRefObject<FrameData>; board: (Piece | null)[][] }) {
  const dotsRef = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(() => {
    const f = frameRef.current;
    for (let i = 0; i < 64; i++) {
      const dot = dotsRef.current[i];
      if (!dot) continue;
      const row = Math.floor(i / 8);
      const col = i % 8;
      const key = `${row},${col}`;
      const isLegal = f.legalSquares.has(key);
      // Hide dot on the hovered square (hover highlight takes over with the right color)
      const cw = f.dragging ? pixToWorld(f.dragging.x, f.dragging.y, f.turn) : null;
      const hSq = cw ? worldToSquare(cw.x, cw.z) : null;
      const isHovered = f.dragging && hSq?.row === row && hSq?.col === col;
      dot.visible = isLegal && !isHovered;
      if (isLegal) {
        const hasPiece = board[row]?.[col] !== null;
        const [x, , z] = toWorld(row, col);
        dot.position.set(x, SURFACE_Y, z);
        dot.scale.set(hasPiece ? 2.8 : 1, 1, hasPiece ? 2.8 : 1);
        (dot.material as THREE.MeshBasicMaterial).color.set(hasPiece ? LEGAL_CAPTURE_COLOR : LEGAL_MOVE_COLOR);
      }
    }
  });

  return (
    <>
      {Array.from({ length: 64 }, (_, i) => (
        <mesh key={i} ref={(el) => { dotsRef.current[i] = el; }} visible={false}>
          <cylinderGeometry args={[0.15, 0.15, 0.02, 16]} />
          <meshBasicMaterial color={LEGAL_MOVE_COLOR} transparent opacity={0.6} />
        </mesh>
      ))}
    </>
  );
}

function GhostMarker({ frameRef }: { frameRef: MutableRefObject<FrameData> }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const f = frameRef.current;
    if (!f.dragging) { mesh.visible = false; return; }
    mesh.visible = true;
    const [x, , z] = toWorld(f.dragging.fromRow, f.dragging.fromCol);
    mesh.position.set(x, SURFACE_Y, z);
  });

  return (
    <mesh ref={meshRef} visible={false}>
      <cylinderGeometry args={[0.35, 0.35, 0.02, 16]} />
      <meshBasicMaterial color="#666666" transparent opacity={0.4} />
    </mesh>
  );
}

const SELECTED_COLOR = '#5a8a5a';

function Tiles({ lastMove, selectedSquare }: { lastMove: InteractionState['lastMove']; selectedSquare: InteractionState['selectedSquare'] }) {
  return (
    <>
      {Array.from({ length: BOARD_SIZE }, (_, row) =>
        Array.from({ length: BOARD_SIZE }, (_, col) => {
          const [x, , z] = toWorld(row, col);
          const isSelected = selectedSquare?.row === row && selectedSquare?.col === col;
          const isLastMove =
            (lastMove?.from.row === row && lastMove?.from.col === col) ||
            (lastMove?.to.row === row && lastMove?.to.col === col);
          const color = isSelected ? SELECTED_COLOR : isLastMove ? LAST_MOVE_COLOR : (row + col) % 2 === 0 ? LIGHT_TILE : DARK_TILE;

          return (
            <mesh key={`${row}-${col}`} position={[x, TILE_Y, z]} receiveShadow>
              <boxGeometry args={[SQ, 0.1, SQ]} />
              <meshStandardMaterial color={color} />
            </mesh>
          );
        })
      )}
    </>
  );
}

function BoardFrame() {
  const woodTexture = useLoader(THREE.TextureLoader, '/textures/wood_baseColor.png');
  const frameWidth = 0.5;
  const boardSize = BOARD_SIZE;
  const outer = boardSize + frameWidth * 2;
  const inner = boardSize;
  const frameY = TILE_Y - 0.05;
  const frameH = 0.35;

  // Wood material for the frame
  const frameMat = (
    <meshStandardMaterial
      map={woodTexture}
      color="#8B6914"
      metalness={0.05}
      roughness={0.7}
    />
  );

  return (
    <group>
      {/* Base under the tiles */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[inner + 0.05, 0.5, inner + 0.05]} />
        <meshStandardMaterial color={BOARD_FRAME_COLOR} metalness={0.1} roughness={0.5} />
      </mesh>

      {/* Top frame rail (far side / black side) */}
      <mesh position={[0, frameY, -inner / 2 - frameWidth / 2]} receiveShadow castShadow>
        <boxGeometry args={[outer, frameH, frameWidth]} />
        {frameMat}
      </mesh>
      {/* Bottom frame rail (near side / white side) */}
      <mesh position={[0, frameY, inner / 2 + frameWidth / 2]} receiveShadow castShadow>
        <boxGeometry args={[outer, frameH, frameWidth]} />
        {frameMat}
      </mesh>
      {/* Left frame rail */}
      <mesh position={[-inner / 2 - frameWidth / 2, frameY, 0]} receiveShadow castShadow>
        <boxGeometry args={[frameWidth, frameH, inner]} />
        {frameMat}
      </mesh>
      {/* Right frame rail */}
      <mesh position={[inner / 2 + frameWidth / 2, frameY, 0]} receiveShadow castShadow>
        <boxGeometry args={[frameWidth, frameH, inner]} />
        {frameMat}
      </mesh>
    </group>
  );
}

function CapturedPieceModel({ piece, position, scale }: {
  piece: Piece; position: [number, number, number]; scale: [number, number, number];
}) {
  const { scene } = useGLTF(MODEL_CONFIG[piece.type].path);
  const cloned = useMemo(
    () => clonePieceScene(scene, piece, { transparent: true, opacity: 0.7 }),
    [scene, piece.color, piece.type],
  );

  return (
    <primitive
      object={cloned}
      position={position}
      scale={scale}
      rotation={getRotation(piece.type, piece.color)}
    />
  );
}

function CapturedPieces({ pieces, side }: { pieces: Piece[]; side: 'left' | 'right' }) {
  const spacing = 0.55;
  const capturedScale = 0.5;
  const cols = 2;
  const rows = Math.max(1, Math.ceil(pieces.length / cols));
  const trayW = cols * spacing + 0.4;
  const trayD = rows * spacing + 0.4;

  const xBase = side === 'right' ? HALF + 0.8 + trayW / 2 : -HALF - 0.8 - trayW / 2;
  const zStart = side === 'right' ? HALF : -HALF;
  const zDir = side === 'right' ? -1 : 1;
  const trayZ = zStart + ((rows - 1) / 2) * spacing * zDir + 0.2 * zDir;
  const trayTop = TILE_Y;

  return (
    <>
      {/* Tray base with felt surface */}
      {pieces.length > 0 && (
        <group>
          <mesh position={[xBase, trayTop - 0.06, trayZ]} receiveShadow castShadow>
            <boxGeometry args={[trayW, 0.12, trayD]} />
            <meshStandardMaterial color="#2A1F14" roughness={0.9} />
          </mesh>
          {/* Green felt top */}
          <mesh position={[xBase, trayTop + 0.005, trayZ]} receiveShadow>
            <boxGeometry args={[trayW - 0.06, 0.01, trayD - 0.06]} />
            <meshStandardMaterial color="#2D4A2D" roughness={1} />
          </mesh>
        </group>
      )}

      {/* Pieces sitting on top of the tray */}
      {pieces.map((piece, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const config = MODEL_CONFIG[piece.type];
        const scale = config.scale.map(s => s * capturedScale) as [number, number, number];
        const xOff = (col - (cols - 1) / 2) * spacing;
        const zOff = row * spacing * zDir;

        return (
          <CapturedPieceModel
            key={`captured-${i}-${piece.type}-${piece.color}`}
            piece={piece}
            position={[
              xBase + xOff,
              trayTop + config.y * capturedScale * 0.5,
              zStart + 0.2 * zDir + zOff,
            ]}
            scale={scale}
          />
        );
      })}
    </>
  );
}

// --- Reflective floor under the board ---
function ReflectiveFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.26, 0]} receiveShadow>
      <planeGeometry args={[30, 30]} />
      <MeshReflectorMaterial
        blur={[300, 100]}
        resolution={1024}
        mixBlur={1}
        mixStrength={0.5}
        roughness={1}
        depthScale={1.2}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.4}
        color="#050505"
        metalness={0.5}
        mirror={0.3}
      />
    </mesh>
  );
}

function CameraRig({ turn }: { turn: 'white' | 'black' }) {
  const angleRef = useRef(0);
  
  useFrame((state) => {
    const targetAngle = turn === 'white' ? 0 : Math.PI;
    let diff = targetAngle - angleRef.current;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    
    angleRef.current += diff * 0.04;
    
    const r = 7.5;
    const h = 8.5;
    state.camera.position.x = Math.sin(angleRef.current) * r;
    state.camera.position.z = Math.cos(angleRef.current) * r;
    state.camera.position.y = h;
    state.camera.lookAt(0, 0, 0);
  });
  
  return null;
}

function Scene({ state, frameRef }: { state: InteractionState; frameRef: MutableRefObject<FrameData> }) {
  return (
    <>
      <CameraRig turn={state.turn} />
      {/* Subtle fog fading into black */}
      <fog attach="fog" args={['#000000', 10, 25]} />

      {/* Environment IBL for realistic reflections on pieces */}
      <Environment preset="night" background={false} />

      {/* Lighting */}
      <ambientLight intensity={0.15} />
      <directionalLight
        position={[5, 12, 5]}
        intensity={0.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={50}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      {/* Overhead spotlight — warm light projecting down */}
      <spotLight
        position={[0, 10, 0]}
        target-position={[0, 0, 0]}
        intensity={40}
        angle={0.7}
        penumbra={0.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        color="#FFF5E6"
      />
      <pointLight position={[0, 5, 0]} intensity={3} color="#FFF0D0" distance={8} />
      {/* Warm fill from side */}
      <pointLight position={[6, 6, -6]} intensity={0.3} color="#FFE4B5" />

      {/* Reflective floor */}
      <ReflectiveFloor />

      {/* Board */}
      <BoardFrame />
      <Tiles lastMove={state.lastMove} selectedSquare={state.selectedSquare} />

      {/* Pieces */}
      {state.board.map((rowArr, row) =>
        rowArr.map((piece, col) =>
          piece ? <PieceModel key={`${row}-${col}-${piece.type}-${piece.color}`} piece={piece} row={row} col={col} frameRef={frameRef} /> : null
        )
      )}

      {/* Interactive overlays */}
      <HoverHighlight frameRef={frameRef} board={state.board} />
      <LegalMoveDots frameRef={frameRef} board={state.board} />
      <GhostMarker frameRef={frameRef} />
      <DraggedPiece frameRef={frameRef} draggingPiece={state.draggingPiece} />
      <Cursor frameRef={frameRef} />

      {/* Captured pieces */}
      <CapturedPieces pieces={state.capturedByWhite} side="right" />
      <CapturedPieces pieces={state.capturedByBlack} side="left" />

      <ContactShadows position={[0, -0.25, 0]} opacity={0.6} blur={2.5} far={10} />
    </>
  );
}

export default function ChessBoard3D({ state, frameRef }: { state: InteractionState; frameRef: MutableRefObject<FrameData> }) {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 8.5, 7.5], fov: 55, near: 0.1, far: 100 }}
      className="w-full h-full"
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.9 }}
    >
      <Suspense fallback={null}>
        <Scene state={state} frameRef={frameRef} />
      </Suspense>
    </Canvas>
  );
}
