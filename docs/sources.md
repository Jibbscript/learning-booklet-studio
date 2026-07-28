# Platform sources and bounded assumptions

Verified against the linked primary documentation on 2026-07-22. Platform behavior can change; release engineering must recheck these sources and record observed desktop behavior rather than treating this file as permanent platform truth.

## Documented OpenAI platform facts

| Fact used by this architecture | Primary source |
|---|---|
| A Codex plugin can combine skills and an MCP-backed app, and plugins are available in Codex mode in the ChatGPT desktop app. | [Plugins overview](https://learn.chatgpt.com/docs/plugins#overview) |
| The plugin bundle is rooted by `.codex-plugin/plugin.json` and can reference skills, app/MCP descriptors, assets, and hooks. | [Plugin structure](https://learn.chatgpt.com/docs/build-plugins#plugin-structure) |
| A local plugin can point to a developer-mode MCP app and be installed through a local marketplace; changes require the documented refresh/restart flow and a fresh task for reliable discovery. | [Build plugins](https://learn.chatgpt.com/docs/build-plugins#create-and-test-a-plugin-locally-that-points-to-an-mcp-server-backed-dev-mode-app) and [manual local install](https://learn.chatgpt.com/docs/build-plugins#install-a-local-plugin-manually) |
| A custom Apps SDK component is web content rendered in a sandboxed iframe and is delivered by an MCP tool/resource contract. | [Build your ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui#overview) and [MCP Apps compatibility](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt#recommended-approach) |
| The standard component MIME is `text/html;profile=mcp-app`; render tools associate a versioned UI resource through `_meta.ui.resourceUri`. | [Register a component template](https://developers.openai.com/apps-sdk/build/mcp-server#step-1--register-a-component-template) |
| The Apps bridge exposes MCP tool calls and host UI/model-context messaging; this documentation does not grant an iframe a direct local skill, shell, or filesystem API. | [MCP Apps UI bridge](https://developers.openai.com/apps-sdk/reference#mcp-apps-ui-bridge) |
| Widget instances are message-scoped, so durable product state belongs on the server or another authoritative store rather than only in component-local state. | [State management](https://developers.openai.com/apps-sdk/build/state-management#how-ui-components-live-inside-chatgpt) |
| Local app development uses a reachable HTTPS MCP endpoint, Inspector/testing, and a developer-mode app; production requires a stable HTTPS endpoint. | [Run locally](https://developers.openai.com/apps-sdk/quickstart#run-locally), [connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt#create-a-developer-mode-app), [testing](https://developers.openai.com/apps-sdk/deploy/testing), and [deployment](https://developers.openai.com/apps-sdk/deploy#deployment-options) |
| Public submission targets the MCP server endpoint rather than an already-created developer app reference. | [Submit plugins](https://learn.chatgpt.com/docs/submit-plugins#submit-the-mcp-server-not-an-existing-app-reference) |

## AG-UI reference facts

| Fact used by this architecture | Primary source |
|---|---|
| AG-UI defines event categories, snapshots/deltas, tool events, interrupt/resume concepts, and a client/server architecture that are useful design references. | [Events](https://docs.ag-ui.com/concepts/events), [state](https://docs.ag-ui.com/concepts/state), [tools](https://docs.ag-ui.com/concepts/tools), [interrupts](https://docs.ag-ui.com/concepts/interrupts), and [architecture](https://docs.ag-ui.com/concepts/architecture) |
| The TypeScript core schemas are inspectable in the upstream repository; the MVP reference baseline is intentionally pinned to `@ag-ui/core` `0.0.57`. | [Core source](https://github.com/ag-ui-protocol/ag-ui/tree/main/sdks/typescript/packages/core/src) |
| AG-UI is distributed under the MIT License. | [AG-UI license](https://github.com/ag-ui-protocol/ag-ui/blob/main/LICENSE) |

## Web standards

| Standard used by this architecture | Primary source |
|---|---|
| Applicable accessibility acceptance targets WCAG 2.2 Level AA; automated checks supplement rather than replace criterion-scoped manual inspection. | [Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/) |
| Any future `STATE_DELTA` payload uses JSON Patch, while `STATE_SNAPSHOT` remains the required recovery primitive. | [RFC 6902: JSON Patch](https://www.rfc-editor.org/rfc/rfc6902) |

## Product decisions and inferences—not platform guarantees

| Statement | Classification and consequence |
|---|---|
| The widget is an inspect-and-decide surface and cannot directly execute the local skill. | Conservative product boundary inferred from the documented bridge surface. If OpenAI later documents a safe direct capability, adopting it still requires an ADR, threat review, and contract tests. |
| “Native macOS” describes the verified ChatGPT desktop host process and end-to-end journey, not an AppKit plugin implementation. | Architecture interpretation. The component remains iframe web content; production evidence must prove an `x86_64` Intel host/process. An `arm64` Apple Silicon journey without Rosetta is independently reportable as a non-blocking compatibility advisory. Neither architecture may be marked passed until its own journey executes. |
| `codex-skill-ui/1` is AG-UI-inspired but not AG-UI wire-compatible. | Deliberate compatibility boundary. The dialect is transported through MCP Apps contracts in ChatGPT. |
| `afterSeq` paging and remote projection are Learning Booklet Studio extensions. | Product-owned behavior, not an AG-UI reconnect guarantee. |
| GPT-5.6 Sol is the target for prompt/eval optimization. | Evaluation choice only. Plugin metadata and runtime contracts do not pin or enforce a model. |
| A self-contained generated `index.html` can work offline while the MCP-backed widget cannot. | Product architecture. Offline evidence applies to the generated artifact, not to remote orchestration UI availability. |

## Unsupported claims the product must not make

- The widget is a native AppKit extension, persistent sidebar, or unrestricted desktop integration.
- ChatGPT/Codex guarantees direct iframe access to skills, shell commands, or local files.
- The app is AG-UI compliant or interoperable beyond explicitly tested adapters.
- Installing the plugin selects or enforces GPT-5.6 Sol.
- Passing browser or Inspector tests proves native ChatGPT desktop behavior on either supported architecture.
- Passing the native Intel journey proves the Apple Silicon journey, or vice versa.
- A local developer app ID is itself the public submission target.
