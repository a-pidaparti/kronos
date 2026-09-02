// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gateway = vi.hoisted(() => ({
  connectionState: "idle",
  connect: vi.fn(),
  close: vi.fn(),
  request: vi.fn(),
  stateHandlers: new Set<(state: string) => void>(),
  eventHandlers: new Set<(event: unknown) => void>(),
}));

vi.mock("@/lib/gatewayClient", () => ({
  GatewayClient: class {
    get connectionState() {
      return gateway.connectionState;
    }

    connect() {
      return gateway.connect();
    }

    close() {
      gateway.close();
    }

    request<T>(method: string, params?: unknown): Promise<T> {
      return gateway.request(method, params) as Promise<T>;
    }

    onState(handler: (state: string) => void) {
      gateway.stateHandlers.add(handler);
      return () => gateway.stateHandlers.delete(handler);
    }

    onAny(handler: (event: unknown) => void) {
      gateway.eventHandlers.add(handler);
      return () => gateway.eventHandlers.delete(handler);
    }
  },
}));

vi.mock("@/components/ChatSessionList", () => ({
  ChatSessionList: () => <div data-testid="session-list" />,
}));
vi.mock("@/contexts/usePageHeader", () => ({
  usePageHeader: () => ({ setTitle: vi.fn() }),
}));
vi.mock("@/contexts/useProfileScope", () => ({
  useProfileScope: () => ({
    profile: "",
    profiles: ["default", "research"],
    currentProfile: "default",
    setProfile: vi.fn(),
  }),
}));

let container: HTMLDivElement;
let root: Root;

async function render(ui: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
}

function emit(event: unknown) {
  for (const handler of gateway.eventHandlers) handler(event);
}

beforeEach(() => {
  gateway.connectionState = "idle";
  gateway.connect.mockReset();
  gateway.close.mockReset();
  gateway.request.mockReset();
  gateway.stateHandlers.clear();
  gateway.eventHandlers.clear();
  gateway.connect.mockImplementation(async () => {
    gateway.connectionState = "open";
    for (const handler of gateway.stateHandlers) handler("open");
  });
  gateway.request.mockImplementation(async (method: string) => {
    if (method === "session.create") {
      return {
        session_id: "runtime-1",
        stored_session_id: "stored-1",
        messages: [],
        info: { model: "test-model", provider: "test-provider" },
      };
    }
    return {};
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

describe("ChatPage", () => {
  it("creates a structured session, submits a prompt, and renders its stream", async () => {
    const { default: ChatPage } = await import("./ChatPage");
    await render(
      <MemoryRouter initialEntries={["/chat"]}>
        <ChatPage isActive />
      </MemoryRouter>,
    );

    await vi.waitFor(() =>
      expect(gateway.request).toHaveBeenCalledWith("session.create", {
        profile: "default",
        source: "web",
      }),
    );

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Summarize the rollout");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Send message"]')
        ?.click();
    });

    expect(gateway.request).toHaveBeenCalledWith("prompt.submit", {
      session_id: "runtime-1",
      text: "Summarize the rollout",
    });

    await act(async () => {
      emit({ type: "message.start", session_id: "runtime-1" });
      emit({
        type: "message.delta",
        session_id: "runtime-1",
        payload: { text: "The rollout is healthy." },
      });
      emit({
        type: "message.complete",
        session_id: "runtime-1",
        payload: { text: "The rollout is healthy." },
      });
    });

    expect(container.textContent).toContain("Summarize the rollout");
    expect(container.textContent).toContain("The rollout is healthy.");
  });

  it("uses the durable session_key returned by resume", async () => {
    gateway.request.mockImplementation(async (method: string) => {
      if (method === "session.resume") {
        return {
          session_id: "runtime-resumed",
          session_key: "stored-1",
          messages: [{ role: "assistant", content: "Welcome back" }],
          info: {},
        };
      }
      return {};
    });

    const { default: ChatPage } = await import("./ChatPage");
    await render(
      <MemoryRouter initialEntries={["/chat?resume=stored-1"]}>
        <ChatPage isActive />
      </MemoryRouter>,
    );

    await vi.waitFor(() =>
      expect(gateway.request).toHaveBeenCalledWith("session.resume", {
        profile: "default",
        session_id: "stored-1",
      }),
    );
    expect(container.textContent).toContain("Welcome back");
  });
});
