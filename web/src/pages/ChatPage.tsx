import { Button } from "@nous-research/ui/ui/components/button";
import type { GatewayEvent } from "@hermes/shared";
import {
  AlertCircle,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  MessageSquarePlus,
  PanelRight,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router";

import { ChatSessionList } from "@/components/ChatSessionList";
import { usePageHeader } from "@/contexts/usePageHeader";
import { useProfileScope } from "@/contexts/useProfileScope";
import { GatewayClient, type ConnectionState } from "@/lib/gatewayClient";
import {
  applyNativeChatEvent,
  gatewayEventBelongsToSession,
  normalizeGatewayHistory,
  resolveGatewayStoredSessionId,
  type NativeChatMessage,
  type NativeChatState,
} from "@/lib/native-chat";
import { cn } from "@/lib/utils";

interface SessionResult {
  session_id: string;
  stored_session_id?: string;
  session_key?: string;
  resumed?: string;
  messages?: unknown;
  info?: {
    model?: string;
    provider?: string;
    cwd?: string;
    title?: string;
  };
}

interface ApprovalRequest {
  request_id?: string;
  command?: string;
  reason?: string;
  choices?: string[];
}

interface SessionDetails {
  cwd: string;
  model: string;
  provider: string;
  title: string;
}

const EMPTY_CHAT: NativeChatState = {
  messages: [],
  busy: false,
  status: "Ready",
};

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: "Offline",
  connecting: "Connecting",
  open: "Connected",
  closed: "Disconnected",
  error: "Connection error",
};

function messageId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function displayAgentName(profile: string): string {
  if (!profile || profile === "default") return "Kronos";
  return profile
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function textPayload(event: GatewayEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

export default function ChatPage({ isActive = true }: { isActive?: boolean }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile, profiles, currentProfile, setProfile } = useProfileScope();
  const { setTitle } = usePageHeader();
  const gateway = useMemo(() => new GatewayClient(), []);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [chat, setChat] = useState<NativeChatState>(EMPTY_CHAT);
  const [details, setDetails] = useState<SessionDetails>({
    cwd: "",
    model: "",
    provider: "",
    title: "",
  });
  const [runtimeSessionId, setRuntimeSessionId] = useState<string | null>(null);
  const [storedSessionId, setStoredSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [activationNonce, setActivationNonce] = useState(0);
  const [sessionListRefresh, setSessionListRefresh] = useState(0);
  const [loadingSession, setLoadingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [deskOpen, setDeskOpen] = useState(true);
  const runtimeRef = useRef<string | null>(null);
  const storedRef = useRef<string | null>(null);
  const activeProfileRef = useRef("");
  const eventCounterRef = useRef(0);
  const activationRequestRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const resumeParam = searchParams.get("resume");
  const selectedProfile = profile || currentProfile || "default";
  const agentName = displayAgentName(selectedProfile);

  useEffect(() => {
    runtimeRef.current = runtimeSessionId;
  }, [runtimeSessionId]);

  useEffect(() => {
    storedRef.current = storedSessionId;
  }, [storedSessionId]);

  useEffect(() => {
    if (!isActive) return;
    setTitle(details.title || agentName);
    return () => setTitle(null);
  }, [agentName, details.title, isActive, setTitle]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [chat.messages, chat.status]);

  useEffect(() => {
    let disposed = false;
    const offState = gateway.onState(setConnection);
    const offAny = gateway.onAny((event) => {
      if (!gatewayEventBelongsToSession(event, runtimeRef.current)) return;
      const payload = textPayload(event);

      if (event.type === "session.info") {
        setDetails((current) => ({
          cwd: typeof payload.cwd === "string" ? payload.cwd : current.cwd,
          model:
            typeof payload.model === "string" ? payload.model : current.model,
          provider:
            typeof payload.provider === "string"
              ? payload.provider
              : current.provider,
          title:
            typeof payload.title === "string" ? payload.title : current.title,
        }));
        return;
      }
      if (event.type === "tool.start") {
        const name =
          typeof payload.name === "string" ? payload.name : "Working";
        setActivity(name.replaceAll("_", " "));
        return;
      }
      if (event.type === "tool.complete") {
        setActivity(null);
        return;
      }
      if (event.type === "approval.request") {
        setApproval(payload as ApprovalRequest);
        return;
      }

      const id = `event-${++eventCounterRef.current}`;
      setChat((current) => applyNativeChatEvent(current, event, id));
      if (event.type === "message.complete") {
        setActivity(null);
        setSessionListRefresh((value) => value + 1);
      }
    });

    void gateway.connect().catch((reason: unknown) => {
      if (!disposed) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    });

    return () => {
      disposed = true;
      offState();
      offAny();
      gateway.close();
    };
  }, [gateway]);

  const activateSession = useCallback(
    async (target: string | null) => {
      if (gateway.connectionState !== "open") return;
      if (
        selectedProfile === activeProfileRef.current &&
        runtimeRef.current &&
        (!target || target === storedRef.current)
      ) {
        return;
      }

      const requestId = ++activationRequestRef.current;
      runtimeRef.current = null;
      setRuntimeSessionId(null);
      setLoadingSession(true);
      setError(null);
      setApproval(null);
      setActivity(null);
      setChat(EMPTY_CHAT);

      try {
        const scope = selectedProfile ? { profile: selectedProfile } : {};
        const result = target
          ? await gateway.request<SessionResult>("session.resume", {
              ...scope,
              session_id: target,
            })
          : await gateway.request<SessionResult>("session.create", {
              ...scope,
              source: "web",
            });

        if (requestId !== activationRequestRef.current) return;
        const durableSessionId = resolveGatewayStoredSessionId(result, target);
        activeProfileRef.current = selectedProfile;
        runtimeRef.current = result.session_id;
        storedRef.current = durableSessionId;
        setRuntimeSessionId(result.session_id);
        setStoredSessionId(durableSessionId);
        setChat({
          messages: normalizeGatewayHistory(result.messages),
          busy: false,
          status: "Ready",
        });
        setDetails({
          cwd: result.info?.cwd || "",
          model: result.info?.model || "",
          provider: result.info?.provider || "",
          title: result.info?.title || "",
        });
      } catch (reason) {
        if (requestId === activationRequestRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (requestId === activationRequestRef.current) {
          setLoadingSession(false);
        }
      }
    },
    [gateway, selectedProfile],
  );

  useEffect(() => {
    if (connection !== "open") return;
    const activate = () => void activateSession(resumeParam);
    queueMicrotask(activate);
  }, [activateSession, activationNonce, connection, resumeParam]);

  const startNewChat = useCallback(() => {
    runtimeRef.current = null;
    storedRef.current = null;
    setRuntimeSessionId(null);
    setStoredSessionId(null);
    setDraft("");
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("resume");
        return next;
      },
      { replace: false },
    );
    setActivationNonce((value) => value + 1);
    setMobileRailOpen(false);
  }, [setSearchParams]);

  const selectAgent = useCallback(
    (name: string) => {
      if (name === selectedProfile) return;
      setProfile(name);
      runtimeRef.current = null;
      storedRef.current = null;
      setRuntimeSessionId(null);
      setStoredSessionId(null);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("profile", name);
          next.delete("resume");
          return next;
        },
        { replace: true },
      );
      setActivationNonce((value) => value + 1);
      setMobileRailOpen(false);
    },
    [selectedProfile, setProfile, setSearchParams],
  );

  const submit = useCallback(async () => {
    const text = draft.trim();
    const sessionId = runtimeRef.current;
    if (!text || !sessionId || chat.busy) return;

    setDraft("");
    setError(null);
    setChat((current) => ({
      ...current,
      busy: true,
      status: "Sending",
      messages: [
        ...current.messages,
        { id: messageId("user"), role: "user", text },
      ],
    }));

    try {
      await gateway.request("prompt.submit", { session_id: sessionId, text });
      if (!resumeParam && storedRef.current) {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set("resume", storedRef.current || "");
            return next;
          },
          { replace: true },
        );
      }
      setSessionListRefresh((value) => value + 1);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setChat((current) => ({
        busy: false,
        status: "Needs attention",
        messages: [
          ...current.messages,
          {
            id: messageId("error"),
            role: "assistant",
            text: message,
            error: true,
          },
        ],
      }));
    }
  }, [chat.busy, draft, gateway, resumeParam, setSearchParams]);

  const stop = useCallback(async () => {
    if (!runtimeRef.current) return;
    try {
      await gateway.request("session.interrupt", {
        session_id: runtimeRef.current,
      });
      setChat((current) => ({ ...current, busy: false, status: "Stopped" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [gateway]);

  const reconnect = useCallback(async () => {
    const durableSessionId = storedRef.current || resumeParam;
    runtimeRef.current = null;
    setRuntimeSessionId(null);
    setError(null);
    if (durableSessionId) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("resume", durableSessionId);
          return next;
        },
        { replace: true },
      );
    }
    try {
      await gateway.connect();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [gateway, resumeParam, setSearchParams]);

  const respondToApproval = useCallback(
    async (choice: "deny" | "once") => {
      if (!runtimeRef.current) return;
      try {
        await gateway.request("approval.respond", {
          session_id: runtimeRef.current,
          request_id: approval?.request_id,
          choice,
        });
        setApproval(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [approval, gateway],
  );

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex overflow-hidden bg-[#f6f7f4] text-[#17201d]">
      {mobileRailOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-20 bg-black/25 lg:hidden"
          onClick={() => setMobileRailOpen(false)}
        />
      )}

      <aside
        className={cn(
          "z-30 flex w-[18rem] shrink-0 flex-col border-r border-black/8 bg-[#eef0eb] transition-transform",
          "fixed inset-y-0 left-0 lg:static",
          mobileRailOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex h-17 items-center justify-between border-b border-black/7 px-5">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-[#17201d] text-[#f4f1e8]">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="text-base font-semibold tracking-[-0.02em]">
                Kronos
              </div>
              <div className="text-[0.68rem] font-medium uppercase tracking-[0.16em] text-black/42">
                Agent desk
              </div>
            </div>
          </div>
          <button
            aria-label="Close navigation"
            className="rounded-lg p-2 text-black/45 hover:bg-black/5 lg:hidden"
            onClick={() => setMobileRailOpen(false)}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-3 pt-3">
          <button
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#17201d] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#27332f]"
            onClick={startNewChat}
          >
            <MessageSquarePlus className="size-4" />
            New conversation
          </button>
        </div>

        <div className="px-3 pt-5">
          <div className="px-2 pb-2 text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-black/38">
            Agents
          </div>
          <div className="space-y-1">
            {(profiles.length ? profiles : [selectedProfile]).map((name) => {
              const active = name === selectedProfile;
              return (
                <button
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                    active
                      ? "bg-white text-[#17201d] shadow-sm"
                      : "text-black/58 hover:bg-white/60 hover:text-[#17201d]",
                  )}
                  key={name}
                  onClick={() => selectAgent(name)}
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold",
                      active
                        ? "bg-[#dce9df] text-[#244c34]"
                        : "bg-black/5 text-black/45",
                    )}
                  >
                    {displayAgentName(name).charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {displayAgentName(name)}
                    </span>
                    <span className="block truncate text-xs text-black/38">
                      Persistent agent
                    </span>
                  </span>
                  {active && <Check className="size-3.5 text-[#397250]" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 min-h-0 flex-1 border-t border-black/7 px-2 pt-4">
          <ChatSessionList
            activeSessionId={storedSessionId || resumeParam}
            className="h-full"
            onNewChat={startNewChat}
            onPicked={() => setMobileRailOpen(false)}
            profile={selectedProfile}
            refreshKey={sessionListRefresh}
            showNewChat={false}
          />
        </div>

        <div className="border-t border-black/7 p-3">
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-black/52 transition hover:bg-white/60 hover:text-[#17201d]"
            onClick={() => navigate("/profiles")}
          >
            <Settings className="size-4" />
            Administration
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex h-17 shrink-0 items-center justify-between border-b border-black/7 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Open navigation"
              className="rounded-lg p-2 text-black/50 hover:bg-black/5 lg:hidden"
              onClick={() => setMobileRailOpen(true)}
            >
              <ChevronRight className="size-5" />
            </button>
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[#dce9df] text-[#244c34]">
              <Bot className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-[-0.01em]">
                {details.title || agentName}
              </h1>
              <div className="flex items-center gap-1.5 text-xs text-black/42">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    connection === "open" ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                {CONNECTION_LABEL[connection]}
                {chat.busy && <span>· {chat.status}</span>}
              </div>
            </div>
          </div>
          {(connection === "closed" || connection === "error") && (
            <button
              className="rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
              onClick={() => void reconnect()}
            >
              Reconnect
            </button>
          )}
          <button
            aria-pressed={deskOpen}
            className={cn(
              "rounded-xl border px-3 py-2 text-xs font-medium transition",
              deskOpen
                ? "border-[#315e43]/20 bg-[#e8f0e9] text-[#315e43]"
                : "border-black/8 text-black/48 hover:bg-black/4",
            )}
            onClick={() => setDeskOpen((open) => !open)}
          >
            <span className="flex items-center gap-2">
              <PanelRight className="size-4" />
              <span className="hidden sm:inline">Agent desk</span>
            </span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col bg-[#fbfcfa]">
            <div
              className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"
              ref={transcriptRef}
            >
              <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
                {loadingSession ? (
                  <div className="grid flex-1 place-items-center">
                    <div className="flex items-center gap-2 text-sm text-black/42">
                      <RefreshCw className="size-4 animate-spin" />
                      Opening conversation
                    </div>
                  </div>
                ) : chat.messages.length === 0 ? (
                  <div className="grid flex-1 place-items-center py-16">
                    <div className="max-w-md text-center">
                      <div className="mx-auto mb-5 grid size-13 place-items-center rounded-2xl bg-[#e3ece4] text-[#2d6543]">
                        <Sparkles className="size-5" />
                      </div>
                      <h2 className="text-2xl font-semibold tracking-[-0.035em] text-[#17201d]">
                        Work with {agentName}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-black/46">
                        Ask for an outcome, share context, or continue a
                        standing responsibility. Internal execution stays out of
                        the conversation.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-7 pb-4">
                    {chat.messages.map((message) => (
                      <ChatMessageBubble key={message.id} message={message} />
                    ))}
                  </div>
                )}

                {approval && (
                  <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-700" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-amber-950">
                          Approval required
                        </div>
                        <p className="mt-1 text-sm leading-5 text-amber-900/70">
                          {approval.reason ||
                            "The agent wants to perform a consequential action."}
                        </p>
                        {approval.command && (
                          <code className="mt-3 block overflow-x-auto rounded-lg bg-amber-950/5 px-3 py-2 text-xs text-amber-950/75">
                            {approval.command}
                          </code>
                        )}
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void respondToApproval("once")}
                          >
                            Allow once
                          </Button>
                          <Button
                            outlined
                            size="sm"
                            onClick={() => void respondToApproval("deny")}
                          >
                            Deny
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1 wrap-break-word">
                      {error}
                    </span>
                    <button
                      aria-label="Dismiss error"
                      onClick={() => setError(null)}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 border-t border-black/6 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-8">
              <div className="mx-auto max-w-3xl">
                {activity && (
                  <div className="mb-2 flex items-center gap-2 px-1 text-xs text-black/40">
                    <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                    {agentName} is using {activity}
                  </div>
                )}
                <div className="flex items-end gap-2 rounded-2xl border border-black/10 bg-[#fbfcfa] p-2 shadow-[0_8px_30px_rgba(23,32,29,0.07)] focus-within:border-[#3d6b4c]/35 focus-within:ring-3 focus-within:ring-[#3d6b4c]/8">
                  <textarea
                    aria-label={`Message ${agentName}`}
                    className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2 text-[0.95rem] leading-6 text-[#17201d] outline-none placeholder:text-black/30"
                    disabled={loadingSession || connection !== "open"}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onComposerKeyDown}
                    placeholder={`Message ${agentName}`}
                    rows={1}
                    value={draft}
                  />
                  {chat.busy ? (
                    <button
                      aria-label="Stop response"
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#17201d] text-white transition hover:bg-[#27332f]"
                      onClick={() => void stop()}
                    >
                      <CircleStop className="size-4" />
                    </button>
                  ) : (
                    <button
                      aria-label="Send message"
                      className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#17201d] text-white transition hover:bg-[#27332f] disabled:cursor-not-allowed disabled:opacity-30"
                      disabled={
                        !draft.trim() || loadingSession || connection !== "open"
                      }
                      onClick={() => void submit()}
                    >
                      <ArrowUp className="size-4" />
                    </button>
                  )}
                </div>
                <div className="mt-2 text-center text-[0.68rem] text-black/30">
                  Enter to send · Shift+Enter for a new line
                </div>
              </div>
            </div>
          </section>

          {deskOpen && (
            <aside className="hidden w-70 shrink-0 border-l border-black/7 bg-[#f6f7f4] p-5 xl:block">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-black/38">
                    Agent desk
                  </div>
                  <div className="mt-1 text-sm font-semibold">{agentName}</div>
                </div>
                <div className="grid size-9 place-items-center rounded-full bg-[#dce9df] text-[#315e43]">
                  <UserRound className="size-4" />
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <DeskField
                  label="Status"
                  value={chat.busy ? chat.status : "Available"}
                />
                <DeskField
                  label="Model"
                  value={details.model || "Profile default"}
                />
                <DeskField
                  label="Provider"
                  value={details.provider || "Automatic"}
                />
                <DeskField
                  label="Workspace"
                  value={details.cwd || "No workspace selected"}
                />
              </div>

              <div className="mt-6 rounded-2xl border border-black/7 bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="size-4 text-[#397250]" />
                  Controlled actions
                </div>
                <p className="mt-2 text-xs leading-5 text-black/43">
                  External integrations remain optional. Consequential writes
                  pause here for your approval.
                </p>
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}

function ChatMessageBubble({ message }: { message: NativeChatMessage }) {
  const user = message.role === "user";
  const system = message.role === "system";

  if (system) {
    return (
      <div className="mx-auto max-w-xl rounded-lg bg-black/3 px-3 py-2 text-center text-xs text-black/42">
        {message.text}
      </div>
    );
  }

  return (
    <article className={cn("flex gap-3", user && "justify-end")}>
      {!user && (
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#dce9df] text-[#315e43]">
          <Sparkles className="size-3.5" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[min(85%,42rem)] whitespace-pre-wrap wrap-break-word text-[0.95rem] leading-7",
          user
            ? "rounded-2xl rounded-br-md bg-[#17201d] px-4 py-2.5 text-white"
            : "pt-0.5 text-[#25302c]",
          message.error &&
            "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800",
        )}
      >
        {message.text || (message.pending ? "Thinking…" : "")}
        {message.pending && message.text && (
          <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-current opacity-40" />
        )}
      </div>
    </article>
  );
}

function DeskField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/7 bg-white px-3.5 py-3">
      <div className="text-[0.65rem] font-semibold uppercase tracking-[0.13em] text-black/32">
        {label}
      </div>
      <div className="mt-1 truncate text-sm text-black/68" title={value}>
        {value}
      </div>
    </div>
  );
}
