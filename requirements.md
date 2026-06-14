# Obsidian AI Chat Plugin Requirements

## Goal

Create a minimal Obsidian plugin that lets the user chat with opencode from inside Obsidian.

The first version must only provide a chat window. It must not edit notes, inspect the vault, index files, create notes, or run autonomous actions.

## Backend

- Use an existing opencode server.
- The user starts opencode separately with `opencode serve`.
- The plugin connects to the configured opencode server over HTTP.
- The plugin does not install, update, or manage opencode.
- The plugin does not manage provider API keys. Provider authentication is handled by opencode.

## Minimum User Flow

1. User opens the plugin settings.
2. User configures the opencode server connection.
3. User selects the model in the plugin settings.
4. User opens the chat window.
5. User sends a message.
6. The plugin displays the assistant response.

## UI Requirements

### Settings

The settings screen must include only:

- Server host
- Server port
- Optional username
- Optional password
- Model selection
- Connection test action

Model selection should use the opencode provider/model information exposed by the server when available.

### Chat Window

The chat window must include only:

- Message history
- Text input
- Send button
- Loading state while waiting for a response
- Error display when the request fails

The chat window must not include note actions, file pickers, vault search, prompt templates, agent tools, diff views, or apply buttons.

## Functional Requirements

- On plugin load, read saved settings.
- On connection test, call opencode health endpoint.
- On first chat message, create an opencode session if no active session exists.
- Send user messages to the active opencode session.
- Display user and assistant messages in order.
- Use the model selected in settings for requests.
- Allow the user to clear the local chat state.

## Non-Goals

The first version must not include:

- Current note context
- Selected text context
- Vault search
- File read/write
- Note creation
- Note editing
- Diff preview
- Revert or apply workflow
- MCP configuration
- Agent permission UI
- opencode process management
- opencode installation
- Mobile support
- Streaming UI, unless it is trivial after the basic request/response flow works

## Safety Requirements

- The plugin must not modify any vault file.
- The plugin must not send note contents automatically.
- The plugin must only send the text entered by the user in the chat input.
- Passwords must not be logged.

## Initial API Usage

- `GET /global/health` for connection testing.
- `GET /provider` or equivalent SDK method for provider/model discovery.
- `POST /session` to create a chat session.
- `POST /session/:id/message` to send a message and receive a response.

## Open Questions

- Whether to use `@opencode-ai/sdk` or direct HTTP calls.
- Whether the model setting should store a single combined model ID or provider ID plus model ID.
- Whether chat history should persist across Obsidian restarts or stay in memory only.
