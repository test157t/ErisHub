# Agent Evolution Module

## Overview
A new module that allows agents to modify their own prompt sections as they learn about the user's preferences over time. Provides both automatic post-chat evolution and on-demand self-editing.

## Architecture

### New hook: `afterChatComplete`
- Fires after `createAssistantMessage()` returns, before `emit("done")` in the stream endpoint
- Gives the module access to: `ChatRequest`, built `prompt`, assistant `message`, `actionResults`, module `settings`

### Evolution log
- Stored at `{agentFolder}/evolution/log.json`
- Each entry: `{ id, timestamp, trigger, changes: [{ section, before, after }], revertedAt? }`
- `before` content stored for reverting

### Message counter
- `{agentFolder}/evolution/state.json` — tracks exchanges since last evolution

## Phases

### Phase 1: Foundation
Files to modify:
- `server/modules/types.ts` — add `afterChatComplete` hook type + `AfterChatContext` type
Files to create:
- `server/modules/evolution.ts` — module definition + hook handler skeleton
Files to modify:
- `server/modules/registry.ts` — import + register
- `server/index.ts` — wire hook between `createAssistantMessage` and `emit("done")`

### Phase 2: Evolution Logic
- Implement meta-prompt for evolution analysis
- Call agent's own provider to analyze conversation and propose block changes
- Parse structured response into section modifications
- Apply changes to agent profile JSON
- Manage message counter (increment, reset on evolve)

### Phase 3: Log CRUD + API Routes
- `POST /api/modules/evolution/evolve` — manual trigger
- `GET /api/modules/evolution/log/:agentId` — fetch log
- `POST /api/modules/evolution/revert/:logEntryId` — revert an evolution entry
- `POST /api/modules/evolution/self-edit` — agent reviews own blocks

### Phase 4: Client EvolutionPanel
- Create `src/components/modules/EvolutionPanel.tsx`
- Settings: auto-evolve toggle, min messages slider, show-toasts checkbox
- Evolution log display with revert buttons
- Manual "Evolve now" button
- Register in `ModuleSettingsPanelRouter.tsx`

### Phase 5: Toast Integration
- Extend SSE `done` payload to include `evolutionEvents`
- Client reads evolution events from done payload, calls `notifyApp()`
- Checkbox to disable toasts

### Phase 6: Self-edit (agent editor)
- "Self-improve" button in agent detail page
- Calls self-edit endpoint
- Shows proposed changes per section with accept/reject

### Phase 7: Chat Manager (nice-to-have)
- "Evolve now" button per chat session in ChatManager

## Key Decisions
- **Provider**: Uses agent's own provider
- **Frequency**: After enough messages accumulate (configurable threshold, default 10)
- **Review**: Changes auto-apply with toast notification + audit log. Log entries are revertible.
- **Safe**: Each log entry stores `before` content for revert. Revert creates a new log entry recording the undo.
