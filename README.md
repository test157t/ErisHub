# ErisHub

A browser-based agentic assistant workspace with chat, coding, voice, media creation, scheduling, reminders, and a modular backend prompt pipeline.

## Run

On Windows, run `start.bat`. It installs dependencies when needed, builds the client, and starts the server on all IPv4 interfaces. Keep its window open while using ErisHub.

Open `http://localhost:8780` on the server computer, or `http://<server-ip>:8780` from a device on its LAN or Tailscale network. The same server serves the built client, API, and assets.

For development, run `npm run dev`. The Vite client uses port `5173` and proxies `/api` and `/assets` to the backend on port `8780`.

## Current Features

- OpenAI-compatible chat-completions request path.
- Mock assistant response when no API key is configured.
- Prompt profile with an editable system block.
- Built-in module registry.
- Toggleable Environment Context module.
- Prompt inspector showing active blocks, modules, and final `messages[]`.
- Page-oriented UI: Chat, Editor, Settings, and Modules are separate views.
- Chat background assets support normalized images and videos.

## Adding A Module

Create a file in `server/modules`, export an `AppModule`, and add it to `server/modules/registry.ts`.

Modules can currently:

- Add prompt blocks with `getPromptBlocks`.
- Transform the built prompt with `afterPromptBuild`.

The core chat route does not need to know what a module does.

## Modules Directory

All module code lives in one place: `server/modules`.
