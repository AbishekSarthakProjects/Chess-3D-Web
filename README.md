# Skyboard | 3D Spatial Interactive Game

An advanced 3D chess simulator controlled entirely through hand gestures and spatial awareness. Played as a local 2-player pass-and-play game with cinematic board rotation.

## Overview

Skyboard combines 3D rendering with real-time hand tracking to create a truly immersive board game experience. Users can interact with the pieces by pinching and dragging their hands in physical space, which is captured via webcam and translated into in-game movements.

## Features

- **Gesture Control**: Powered by MediaPipe for real-time hand landmark detection.
- **3D Render Engine**: Built with React Three Fiber and Three.js for a high-performance 3D environment.
- **AI Opponent**: A sophisticated grandmaster-level AI that analyzes board positions in real-time.
- **Spatial UI**: Minimalist, high-aesthetic interface designed for concentration and immersion.

## Credits

This game was conceptualized and developed by:

- **Abishek Mohan** - Physics & Tracking Engine
- **Sarthak bagal** - 3D Environment Designer

## Development

```bash
npm run dev
```

## How It Works

1. **Hand Tracking**: MediaPipe detects 21 hand landmarks. The 'pinch' gesture is calculated based on the distance between the thumb and index finger.
2. **Move Validation**: Integrated with `chess.js` to ensure only legal moves are made.
3. **Engine Communication**: Moves are sent to a remote AI inference server which responds with the optimal counter-move.

Built with a focus on future-of-gaming interactions.
