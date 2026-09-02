import { buildHermesWebSocketUrl, type GatewayWsUrlResult } from '@hermes/shared'

import type {
  DesktopAgentRoster,
  DesktopBootProgress,
  DesktopBootstrapState,
  DesktopPluginProfileRoute,
  HermesApiRequest,
  HermesConnection,
  HermesReadFileTextResult,
  HermesSelectPathsOptions
} from '@/global'
import type { ProfilesResponse } from '@/types/hermes'

const BROWSER_CONNECTION_ID = 'browser'
const SESSION_HEADER = 'X-Hermes-Session-Token'
const virtualFiles = new Map<string, File>()

function basePath(): string {
  const raw = window.__HERMES_BASE_PATH__?.trim() ?? ''

  if (!raw) {
    return ''
  }

  return `${raw.startsWith('/') ? raw : `/${raw}`}`.replace(/\/+$/, '')
}

function endpoint(path: string): string {
  return `${basePath()}${path.startsWith('/') ? path : `/${path}`}`
}

function withProfile(path: string, profile?: null | string): string {
  const normalized = profile?.trim()

  if (!normalized || new URL(path, window.location.origin).searchParams.has('profile')) {
    return path
  }

  return `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(normalized)}`
}

async function wsAuthParam(): Promise<readonly [string, string]> {
  if (window.__HERMES_AUTH_REQUIRED__) {
    const response = await fetch(endpoint('/api/auth/ws-ticket'), {
      credentials: 'include',
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Could not authorize the Hermes gateway (${response.status}).`)
    }

    const payload = (await response.json()) as { ticket?: string }

    if (!payload.ticket) {
      throw new Error('The Hermes gateway returned an invalid WebSocket ticket.')
    }

    return ['ticket', payload.ticket]
  }

  const token = window.__HERMES_SESSION_TOKEN__ ?? ''

  if (!token) {
    throw new Error('Session token unavailable. Open this page through hermes dashboard.')
  }

  return ['token', token]
}

async function gatewayWsUrl(profile?: null | string): Promise<GatewayWsUrlResult> {
  return {
    ok: true,
    wsUrl: buildHermesWebSocketUrl({
      authParam: await wsAuthParam(),
      basePath: basePath(),
      path: '/api/ws',
      params: profile?.trim() ? { profile: profile.trim() } : undefined
    })
  }
}

async function browserApi<T>(request: HermesApiRequest): Promise<T> {
  if (request.connectionId && request.connectionId !== BROWSER_CONNECTION_ID && request.connectionId !== 'local') {
    throw new Error(`Connection "${request.connectionId}" is not available in this browser.`)
  }

  const controller = new AbortController()
  const timeout = request.timeoutMs
    ? window.setTimeout(() => controller.abort(), request.timeoutMs)
    : null

  try {
    const headers = new Headers()
    const token = window.__HERMES_SESSION_TOKEN__

    if (token) {
      headers.set(SESSION_HEADER, token)
    }

    let body: BodyInit | undefined

    if (request.upload) {
      const form = new FormData()
      form.append(
        'file',
        new Blob([request.upload.bytes], {
          type: request.upload.contentType || 'application/octet-stream'
        }),
        request.upload.filename
      )
      body = form
    } else if (request.body !== undefined) {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(request.body)
    }

    const response = await fetch(endpoint(withProfile(request.path, request.profile)), {
      body,
      credentials: 'include',
      headers,
      method: request.method ?? (body ? 'POST' : 'GET'),
      signal: controller.signal
    })

    if (response.status === 401) {
      const auth = (await response.clone().json().catch(() => null)) as {
        error?: string
        login_url?: string
      } | null

      if (auth?.login_url && (auth.error === 'unauthenticated' || auth.error === 'session_expired')) {
        window.location.assign(auth.login_url)
        return new Promise<T>(() => undefined)
      }
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText)
      throw new Error(`${response.status}: ${detail}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    const contentType = response.headers.get('content-type') ?? ''

    return (contentType.includes('application/json') ? response.json() : response.text()) as Promise<T>
  } finally {
    if (timeout !== null) {
      window.clearTimeout(timeout)
    }
  }
}

function normalizedProfile(profile?: null | string): string | undefined {
  const value = profile?.trim()

  return value && value !== 'default' ? value : undefined
}

async function browserConnection(profile?: null | string, registryScoped = false): Promise<HermesConnection> {
  const profileName = normalizedProfile(profile)
  const authMode = window.__HERMES_AUTH_REQUIRED__ ? 'oauth' : 'token'
  const result =
    authMode === 'oauth'
      ? {
          ok: true as const,
          wsUrl: buildHermesWebSocketUrl({
            basePath: basePath(),
            path: '/api/ws',
            params: profileName ? { profile: profileName } : undefined
          })
        }
      : await gatewayWsUrl(profileName)

  if (typeof result !== 'object' || !result.ok) {
    throw new Error(typeof result === 'string' ? 'Invalid gateway URL response.' : result.error)
  }

  return {
    authMode,
    baseUrl: `${window.location.origin}${basePath()}`,
    connectionId: BROWSER_CONNECTION_ID,
    isFullscreen: false,
    logs: [],
    mode: 'remote',
    nativeOverlayWidth: 0,
    profile: profileName,
    registryScoped,
    remoteHost: window.location.host,
    remoteIdentity: window.location.origin,
    remoteKind: 'url',
    sharedPrimary: Boolean(profileName) && !registryScoped,
    sharedRemote: registryScoped,
    source: 'settings',
    token: window.__HERMES_SESSION_TOKEN__ ?? '',
    windowButtonPosition: null,
    wsUrl: result.wsUrl
  }
}

async function profiles(): Promise<ProfilesResponse> {
  return browserApi<ProfilesResponse>({ path: '/api/profiles', timeoutMs: 60_000 })
}

async function profileRoutes(): Promise<DesktopPluginProfileRoute[]> {
  const response = await profiles()

  return response.profiles.map(({ name }) => ({
    connectionId: BROWSER_CONNECTION_ID,
    mode: 'remote',
    profile: name,
    targetProfile: name
  }))
}

async function agentRoster(): Promise<DesktopAgentRoster> {
  const response = await profiles()

  return {
    agents: response.profiles.map(({ name }) => ({
      connectionId: BROWSER_CONNECTION_ID,
      connectionKind: 'remote',
      connectionLabel: 'This dashboard',
      handle: `@${name}-dashboard`,
      profile: name,
      targetProfile: name
    })),
    sources: [
      {
        connectionId: BROWSER_CONNECTION_ID,
        kind: 'remote',
        label: 'This dashboard',
        reachable: true
      }
    ]
  }
}

function emptyBootstrapState(): DesktopBootstrapState {
  return {
    active: false,
    completedAt: Date.now(),
    error: null,
    log: [],
    manifest: null,
    setupChoice: null,
    stages: {},
    startedAt: null,
    unsupportedPlatform: null
  }
}

function bootProgress(): DesktopBootProgress {
  return {
    error: null,
    fakeMode: false,
    message: 'Dashboard ready',
    phase: 'ready',
    progress: 100,
    running: false,
    timestamp: Date.now()
  }
}

function virtualPath(file: File): string {
  const key = `browser-file://${crypto.randomUUID()}/${encodeURIComponent(file.name)}`
  virtualFiles.set(key, file)
  return key
}

function chooseFiles(options: HermesSelectPathsOptions = {}): Promise<string[]> {
  if (options.directories) {
    return Promise.resolve([])
  }

  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = options.multiple === true

    const extensions = options.filters?.flatMap(filter => filter.extensions) ?? []
    if (extensions.length) {
      input.accept = extensions.map(extension => `.${extension.replace(/^\./, '')}`).join(',')
    }

    input.addEventListener(
      'change',
      () => resolve(Array.from(input.files ?? []).map(virtualPath)),
      { once: true }
    )
    input.click()
  })
}

async function dataUrlForPath(path: string): Promise<string> {
  const file = virtualFiles.get(path)

  if (!file) {
    const result = await browserApi<{ dataUrl?: string }>({
      path: `/api/fs/read-data-url?path=${encodeURIComponent(path)}`
    })
    return result.dataUrl ?? ''
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read file.')), { once: true })
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')), { once: true })
    reader.readAsDataURL(file)
  })
}

async function textForPath(path: string): Promise<HermesReadFileTextResult> {
  const file = virtualFiles.get(path)

  if (!file) {
    return browserApi<HermesReadFileTextResult>({
      path: `/api/fs/read-text?path=${encodeURIComponent(path)}`
    })
  }

  return {
    byteSize: file.size,
    mimeType: file.type || 'text/plain',
    path,
    text: await file.text(),
    truncated: false
  }
}

function saveUrl(url: string, filename?: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? ''
  anchor.rel = 'noopener'
  anchor.click()
}

const noSubscription = () => () => undefined

export function createBrowserDesktopBridge(): Window['hermesDesktop'] {
  let rememberedProfile: string | null = null

  const bridge: Partial<Window['hermesDesktop']> = {
    api: browserApi,
    cancelBootstrap: async () => ({ cancelled: false, ok: true }),
    claimAmbientCue: async () => true,
    continueBootstrapLocal: async () => ({ ok: false }),
    fetchLinkTitle: async () => '',
    findInPage: async query => ({ count: query ? 0 : 0 }),
    getAgentRoster: agentRoster,
    getBootProgress: async () => bootProgress(),
    getBootstrapState: async () => emptyBootstrapState(),
    getConnection: profile => browserConnection(profile),
    getConnectionFor: ({ connectionId, profile }) => {
      if (connectionId && connectionId !== BROWSER_CONNECTION_ID && connectionId !== 'local') {
        throw new Error(`Connection "${connectionId}" is not available in this browser.`)
      }
      return browserConnection(profile, true)
    },
    getGatewayWsUrl: gatewayWsUrl,
    getGatewayWsUrlFor: ({ connectionId, profile }) => {
      if (connectionId && connectionId !== BROWSER_CONNECTION_ID && connectionId !== 'local') {
        return Promise.resolve({ ok: false, error: `Connection "${connectionId}" is unavailable.` })
      }
      return gatewayWsUrl(profile)
    },
    getPathForFile: virtualPath,
    getProfileRoutes: profileRoutes,
    getRecentLogs: async () => ({ lines: [], path: '' }),
    getRemoteDisplayReason: async () => 'This interface is connected through the browser.',
    getVersion: async () => {
      const status = await browserApi<{ version?: string }>({ path: '/api/status' }).catch(() => ({ version: undefined }))

      return {
        appVersion: status.version ?? 'web',
        electronVersion: '',
        hermesRoot: '',
        nodeVersion: '',
        platform: navigator.platform
      }
    },
    notify: async payload => {
      if (!('Notification' in window) || Notification.permission !== 'granted') {
        return false
      }
      new Notification(payload.title || 'Hermes', { body: payload.body, silent: payload.silent })
      return true
    },
    onBackendExit: noSubscription,
    onBootProgress: noSubscription,
    onBootstrapEvent: noSubscription,
    onBrowserPopoutClosed: noSubscription,
    onFoundInPage: noSubscription,
    onOpenFindBarRequested: noSubscription,
    onPreviewFileChanged: noSubscription,
    openBrowserWindow: async () => ({ ok: false, error: 'Browser pop-outs require the desktop app.' }),
    openExternal: async url => void window.open(url, '_blank', 'noopener,noreferrer'),
    openSessionInTerminal: async () => ({ ok: false, error: 'External terminals require the desktop app.' }),
    openSessionWindow: async sessionId => {
      if (!sessionId) {
        return { ok: false, error: 'Session id required.' }
      }

      window.open(`${window.location.pathname}#/${encodeURIComponent(sessionId)}`, '_blank', 'noopener')
      return { ok: true }
    },
    openWindow: async () => {
      window.open(window.location.href, '_blank', 'noopener')
      return { ok: true }
    },
    profile: {
      get: async () => ({ profile: rememberedProfile }),
      remember: async name => ({ profile: (rememberedProfile = name?.trim() || null) }),
      set: async name => ({ profile: (rememberedProfile = name?.trim() || null) })
    },
    readClipboard: async () => navigator.clipboard.readText(),
    readDir: path => browserApi({ path: `/api/fs/list?path=${encodeURIComponent(path)}` }),
    readFileDataUrl: dataUrlForPath,
    readFileDataUrlForAttach: dataUrlForPath,
    readFileText: textForPath,
    repairBootstrap: async () => ({ ok: false }),
    requestMicrophoneAccess: async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(track => track.stop())
        return true
      } catch {
        return false
      }
    },
    resetBootstrap: async () => ({ ok: false }),
    revealLogs: async () => ({ error: 'Logs are available through the dashboard API.', ok: false, path: '' }),
    saveClipboardImage: async () => '',
    saveImageBuffer: async (data, ext, name) => {
      const bytes = data instanceof Uint8Array ? new Uint8Array(data).buffer : data
      const blob = new Blob([bytes])
      saveUrl(URL.createObjectURL(blob), name ?? `image.${ext.replace(/^\./, '')}`)
      return name ?? `image.${ext.replace(/^\./, '')}`
    },
    saveImageFromUrl: async url => {
      saveUrl(url)
      return true
    },
    sanitizeWorkspaceCwd: async cwd => ({ cwd: cwd?.trim() || '', sanitized: false }),
    selectPaths: chooseFiles,
    settings: {
      getDefaultProjectDir: async () => ({ defaultLabel: 'Backend default', dir: null, resolvedCwd: '' }),
      pickDefaultProjectDir: async () => ({ canceled: true, dir: null }),
      setDefaultProjectDir: async dir => ({ dir })
    },
    stopFindInPage: async () => undefined,
    stopPreviewFileWatch: async () => false,
    touchBackend: async () => ({ ok: true }),
    revalidateConnection: async () => ({ ok: true, rebuilt: false }),
    watchPreviewFile: async path => ({ id: '', path }),
    writeClipboard: async text => {
      await navigator.clipboard.writeText(text)
      return true
    }
  }

  return bridge as Window['hermesDesktop']
}

export function installBrowserDesktopBridge(): void {
  if (!window.hermesDesktop) {
    window.hermesDesktop = createBrowserDesktopBridge()
  }
}
