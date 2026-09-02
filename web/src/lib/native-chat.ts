import type { GatewayEvent } from "@hermes/shared";

export type NativeChatRole = "assistant" | "system" | "user";

export interface NativeChatMessage {
  id: string;
  role: NativeChatRole;
  text: string;
  pending?: boolean;
  interim?: boolean;
  error?: boolean;
  timestamp?: number;
}

interface GatewayHistoryMessage {
  role?: unknown;
  text?: unknown;
  content?: unknown;
  timestamp?: unknown;
}

export interface NativeChatState {
  messages: NativeChatMessage[];
  busy: boolean;
  status: string;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const row = part as Record<string, unknown>;
      return typeof row.text === "string" ? row.text : "";
    })
    .join("");
}

export function normalizeGatewayHistory(value: unknown): NativeChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as GatewayHistoryMessage;
    const role = row.role;
    if (role !== "assistant" && role !== "system" && role !== "user") {
      return [];
    }
    const text = textValue(row.text ?? row.content);
    if (!text.trim()) return [];
    const timestamp =
      typeof row.timestamp === "number" && Number.isFinite(row.timestamp)
        ? row.timestamp
        : undefined;

    return [
      {
        id: `history-${timestamp ?? "untimed"}-${index}`,
        role,
        text,
        ...(timestamp !== undefined ? { timestamp } : {}),
      },
    ];
  });
}

function eventText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return textValue((payload as Record<string, unknown>).text);
}

function updateStreamingAssistant(
  messages: NativeChatMessage[],
  text: string,
  complete: boolean,
  error: boolean,
  id: string,
  responsePreviewed = false,
): NativeChatMessage[] {
  const next = [...messages];
  const index = next.findLastIndex(
    (message) => message.role === "assistant" && message.pending,
  );
  if (index < 0) {
    if (complete) {
      const interimIndex = next.findLastIndex(
        (message) => message.role === "assistant" && message.interim,
      );
      if (interimIndex >= 0) {
        const interim = next[interimIndex];
        const sameReply = Boolean(
          responsePreviewed ||
          !text ||
          text.startsWith(interim.text) ||
          interim.text.startsWith(text),
        );
        if (sameReply) {
          next[interimIndex] = {
            ...interim,
            text: text || interim.text,
            pending: false,
            interim: false,
            error,
          };
          return next;
        }
      }
    }
    next.push({ id, role: "assistant", text, pending: !complete, error });
    return next;
  }

  const current = next[index];
  next[index] = {
    ...current,
    text: complete && text ? text : current.text + text,
    pending: !complete,
    interim: false,
    error,
  };
  return next;
}

export function applyNativeChatEvent(
  state: NativeChatState,
  event: GatewayEvent,
  eventId: string,
): NativeChatState {
  const payload = event.payload as Record<string, unknown> | undefined;

  switch (event.type) {
    case "message.start":
      return {
        ...state,
        busy: true,
        status: "Thinking",
        messages: updateStreamingAssistant(
          state.messages,
          "",
          false,
          false,
          eventId,
        ),
      };
    case "message.delta":
      return {
        ...state,
        busy: true,
        status: "Responding",
        messages: updateStreamingAssistant(
          state.messages,
          eventText(payload),
          false,
          false,
          eventId,
        ),
      };
    case "message.interim": {
      const text = eventText(payload);
      if (!text.trim()) return state;
      const messages = [...state.messages];
      const pendingIndex = messages.findLastIndex(
        (message) => message.role === "assistant" && message.pending,
      );
      if (pendingIndex >= 0) {
        messages[pendingIndex] = {
          ...messages[pendingIndex],
          text,
          pending: false,
          interim: true,
        };
      } else {
        messages.push({ id: eventId, role: "assistant", text, interim: true });
      }
      return {
        ...state,
        messages,
      };
    }
    case "message.complete": {
      const status = payload?.status;
      return {
        ...state,
        busy: false,
        status: "Ready",
        messages: updateStreamingAssistant(
          state.messages,
          eventText(payload),
          true,
          status === "error",
          eventId,
          payload?.response_previewed === true,
        ),
      };
    }
    case "status.update":
      return {
        ...state,
        status: eventText(payload) || state.status,
      };
    case "error": {
      const text =
        typeof payload?.message === "string" ? payload.message : "Agent error";
      return {
        busy: false,
        status: "Needs attention",
        messages: [
          ...state.messages.filter((message) => !message.pending),
          { id: eventId, role: "assistant", text, error: true },
        ],
      };
    }
    default:
      return state;
  }
}

export function gatewayEventBelongsToSession(
  event: GatewayEvent,
  runtimeSessionId: string | null,
): boolean {
  return Boolean(runtimeSessionId && event.session_id === runtimeSessionId);
}

export function resolveGatewayStoredSessionId(
  value: unknown,
  fallback: string | null = null,
): string | null {
  if (!value || typeof value !== "object") return fallback;
  const result = value as Record<string, unknown>;
  for (const key of ["stored_session_id", "session_key", "resumed"]) {
    const candidate = result[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return fallback;
}
