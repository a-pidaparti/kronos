import { describe, expect, it } from "vitest";

import {
  applyNativeChatEvent,
  gatewayEventBelongsToSession,
  normalizeGatewayHistory,
  resolveGatewayStoredSessionId,
  type NativeChatState,
} from "./native-chat";

const EMPTY: NativeChatState = { messages: [], busy: false, status: "Ready" };

describe("native web chat", () => {
  it("normalizes visible conversation history without tool envelopes", () => {
    expect(
      normalizeGatewayHistory([
        { role: "user", text: "Hello", timestamp: 10 },
        { role: "tool", name: "terminal", context: "private" },
        { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
      ]),
    ).toEqual([
      { id: "history-10-0", role: "user", text: "Hello", timestamp: 10 },
      {
        id: "history-untimed-2",
        role: "assistant",
        text: "Hi there",
      },
    ]);
  });

  it("builds one assistant message across streamed deltas", () => {
    const started = applyNativeChatEvent(
      EMPTY,
      { type: "message.start", session_id: "runtime-1" },
      "assistant-1",
    );
    const first = applyNativeChatEvent(
      started,
      {
        type: "message.delta",
        session_id: "runtime-1",
        payload: { text: "Hello" },
      },
      "ignored-1",
    );
    const second = applyNativeChatEvent(
      first,
      {
        type: "message.delta",
        session_id: "runtime-1",
        payload: { text: " world" },
      },
      "ignored-2",
    );
    const complete = applyNativeChatEvent(
      second,
      {
        type: "message.complete",
        session_id: "runtime-1",
        payload: { text: "Hello world" },
      },
      "ignored-3",
    );

    expect(complete.messages).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        text: "Hello world",
        pending: false,
        interim: false,
        error: false,
      },
    ]);
    expect(complete.busy).toBe(false);
  });

  it("rejects events from another runtime session", () => {
    expect(
      gatewayEventBelongsToSession(
        { type: "message.delta", session_id: "runtime-2" },
        "runtime-1",
      ),
    ).toBe(false);
    expect(
      gatewayEventBelongsToSession(
        { type: "message.delta", session_id: "runtime-1" },
        "runtime-1",
      ),
    ).toBe(true);
  });

  it("surfaces terminal failures as an assistant error", () => {
    const state = applyNativeChatEvent(
      EMPTY,
      {
        type: "message.complete",
        session_id: "runtime-1",
        payload: { text: "Provider unavailable", status: "error" },
      },
      "assistant-error",
    );

    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      text: "Provider unavailable",
      error: true,
    });
    expect(state.status).toBe("Ready");
  });

  it("settles a sealed interim response without duplicating it", () => {
    const started = applyNativeChatEvent(
      EMPTY,
      { type: "message.start", session_id: "runtime-1" },
      "assistant-1",
    );
    const streamed = applyNativeChatEvent(
      started,
      {
        type: "message.delta",
        session_id: "runtime-1",
        payload: { text: "I checked the deployment." },
      },
      "ignored-1",
    );
    const interim = applyNativeChatEvent(
      streamed,
      {
        type: "message.interim",
        session_id: "runtime-1",
        payload: { text: "I checked the deployment." },
      },
      "ignored-2",
    );
    const complete = applyNativeChatEvent(
      interim,
      {
        type: "message.complete",
        session_id: "runtime-1",
        payload: { text: "I checked the deployment. It is healthy." },
      },
      "ignored-3",
    );

    expect(complete.messages).toHaveLength(1);
    expect(complete.messages[0]).toMatchObject({
      id: "assistant-1",
      text: "I checked the deployment. It is healthy.",
      pending: false,
      interim: false,
    });
  });

  it("resolves durable identity from create and resume response shapes", () => {
    expect(
      resolveGatewayStoredSessionId({ stored_session_id: "created" }),
    ).toBe("created");
    expect(resolveGatewayStoredSessionId({ session_key: "resumed" })).toBe(
      "resumed",
    );
    expect(resolveGatewayStoredSessionId({}, "target")).toBe("target");
  });
});
