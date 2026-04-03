# AbyssChat

**AbyssChat** is a real-time communication platform designed for privacy-focused collaboration, controlled room access, and a terminal-style user experience.

## Product Overview

The platform is architected around temporary, password-protected rooms and encrypted client message payloads. AbyssChat supports fast, room-based collaboration with in-memory room state and automatic room cleanup when inactive.

## Core Capabilities

- **Ephemeral Room Lifecycle:** Rooms are removed when the final participant leaves, including in-memory room metadata and message history.
- **Access Security:** Room entry is protected by room-specific passwords validated server-side.
- **Encrypted Communication:** Message payloads are encrypted client-side and relayed through a **Socket.IO** backend.
- **Real-Time Presence Signals:** Live participant counts and typing indicators support active collaboration.
- **Abuse Prevention:** `express-rate-limit` is enabled on the HTTP layer to reduce request abuse.

## Architecture

AbyssChat uses a decoupled frontend-backend architecture:

- **Client:** React + Vite
- **Server:** Express + Socket.IO

## Deployment Model

The platform is deployed as a split architecture:

- **Frontend:** Static web application
- **Backend:** Node.js WebSocket-capable service

## Runtime Configuration

Runtime behavior is managed through deployment environment variables:

- `VITE_SERVER_URL`: Target endpoint for the backend service
- `CORS_ORIGINS`: Allowed origins for backend CORS policy
- `PORT`: Backend listener port
- `NODE_ENV`: Runtime environment mode

## Production Operations

- **WebSocket Support:** The backend runs with persistent WebSocket connectivity through Socket.IO.
- **Origin Security:** Cross-origin access is restricted using configured origin allowlists.
- **Active Rate Limiting:** HTTP middleware remains active in production.
- **Observability Readiness:** The deployment model supports centralized logging and monitoring integration.
- **Secret Management:** Sensitive environment values are intended to be managed through cloud secret stores.

## Quality Controls

- Frontend quality is validated with linting and production builds.
- Backend syntax and startup behavior are validated before deployment.


