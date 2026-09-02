# Kronos Agent Desk

## Purpose
Kronos provides an approachable web and desktop workspace for operating persistent Hermes agents, using Guild.ai's The Smith as its product comparison. It serves individuals and organizations that need agents to converse, automate recurring work, collaborate safely, and retain context without exposing Hermes's research-oriented interfaces.

## Users and flows
- Operators create named agents, open each agent's persistent conversation, and inspect concurrent work from one desk.
- Team members chat with agents, attach working material, review outputs, and answer clarification or approval requests.
- Administrators provision isolated profiles, choose capabilities and approval policy, and manage messaging, plugins, schedules, and workflows.
- Operators schedule recurring agent routines and inspect their status, run history, and delivery outcome.
- Operators watch an agent's browser automation and use a backend-provided live desktop handoff when intervention is needed.

## Rules
- **RULE-1:** The web and desktop products present the same contribution-driven agent desk, while capabilities that require Electron or the host OS are hidden, disabled, or fail closed in a browser. This keeps the core workflow consistent without pretending the browser has native authority.
- **RULE-2:** A named Hermes profile is a persistent agent identity. Bot mode resolves that agent's forever-chat by the profile-local canonical title `Bot Chat`; recency and stored session pointers never replace that identity.
- **RULE-3:** Organization, connection, profile, and session ownership travel with authenticated HTTP and WebSocket work. A client must not read, resume, mutate, or route work through another owner's ambient state.
- **RULE-4:** The desk keeps sessions and agents visible beside the active conversation, with supporting workspace panes available without replacing the chat. Narrow layouts may collapse or hide secondary panes, but the active conversation and composer remain usable.
- **RULE-5:** Potentially dangerous actions use the profile's approval policy and surface actionable approval requests in the owning conversation. Approval responses are correlated to that request and session.
- **RULE-6:** Delegated workers are bounded by configured concurrency, depth, iteration, and timeout limits. Their progress and terminal outcomes remain attributable to the parent session.
- **RULE-7:** Routines are durable scheduled jobs scoped to their owning agent/profile. Operators can create, inspect, pause, resume, and run them, and failures remain visible rather than silently changing ownership.
- **RULE-8:** Attachments preserve occurrence identity in the composer, upload through the authenticated gateway boundary, and remain scoped to the selected connection and profile.
- **RULE-9:** Browser automation identity and persistent browser state are profile scoped. An authenticated interactive VNC handoff from the configured backend satisfies human takeover; Kronos exposes that handoff instead of merging browser state across agents.
- **RULE-10:** Agent capabilities expand through Hermes toolsets, skills, MCP servers, and plugins. The desk exposes configured capabilities without adding a second agent runtime or mutating an active conversation's prompt/tool contract.
- **RULE-11:** Conversation memory and history survive ordinary navigation, reconnects, background execution, and context compression. The backend remains authoritative; renderer state is a recoverable view of that truth.

## Non-goals
- Recreating the classic CLI or terminal UI in the browser.
- Exposing Hermes's general execution-backend catalog as a primary product surface.
- Shipping batch processing, trajectory inspection, reinforcement-learning controls, or other research interfaces in the agent desk.
- Treating browser code as if it has Electron, local filesystem, keychain, process, or window-management privileges.
- Making third-party integrations permanent core model-tool surface when an existing edge extension mechanism is sufficient.

## Canonical sources
- `apps/desktop/src/app/contrib/` and `apps/desktop/src/components/pane-shell/` define the shared desk and pane behavior.
- `apps/desktop/src/plugins/hermes-bots/` defines named-agent conversations, collaboration, and routines.
- `apps/desktop/src/browser-main.ts` and `apps/desktop/src/browser/` define the browser capability boundary.
- `apps/desktop/src/app/session/` and `apps/desktop/src/store/session-states.ts` define session ownership, recovery, and prompt routing.
- `hermes_cli/dashboard_auth/`, `hermes_cli/web_server.py`, and `tui_gateway/ws.py` define authenticated web and WebSocket identity propagation.
- `tools/delegate_tool.py`, `tools/browser_camofox.py`, and `cron/` define bounded workers, profile-scoped browser sessions, live-view handoff, and durable routines.
- `tests/gateway/test_browser_control_cloud.py`, `tests/hermes_cli/test_dashboard_auth_ws_auth.py`, and `tests/hermes_cli/test_dashboard_auth_ws_tickets.py` prove browser identity and authentication boundaries.
- `apps/desktop/src/browser/bridge.test.ts`, `apps/desktop/src/plugins/hermes-bots/`, and `apps/desktop/src/store/session-states.test.ts` cover browser adaptation and persistent-agent ownership behavior.
