import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createBrowserDesktopBridge, installBrowserDesktopBridge } from './bridge'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status
  })
}

describe('browser desktop bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.__HERMES_AUTH_REQUIRED__ = false
    window.__HERMES_BASE_PATH__ = '/hermes'
    window.__HERMES_SESSION_TOKEN__ = 'session-token'
  })

  it('routes profile-scoped REST requests through dashboard authentication', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }))
    const bridge = createBrowserDesktopBridge()

    await bridge.api({
      body: { enabled: true },
      method: 'PATCH',
      path: '/api/config?section=agent',
      profile: 'research'
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/hermes/api/config?section=agent&profile=research')
    expect(init?.method).toBe('PATCH')
    expect(new Headers(init?.headers).get('X-Hermes-Session-Token')).toBe('session-token')
    expect(init?.credentials).toBe('include')
  })

  it('reuses the browser gateway as the shared profile backend', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ profiles: [] }))
    const connection = await createBrowserDesktopBridge().getConnection('research')

    expect(connection).toMatchObject({
      connectionId: 'browser',
      mode: 'remote',
      profile: 'research',
      sharedPrimary: true
    })
    expect(connection.wsUrl).toBe('ws://localhost:3000/hermes/api/ws?profile=research&token=session-token')
  })

  it('mints a fresh single-use WebSocket ticket in gated mode', async () => {
    window.__HERMES_AUTH_REQUIRED__ = true
    delete window.__HERMES_SESSION_TOKEN__
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ticket: 'ticket-1' }))
    const result = await createBrowserDesktopBridge().getGatewayWsUrl()

    expect(fetchMock).toHaveBeenCalledWith('/hermes/api/auth/ws-ticket', {
      credentials: 'include',
      method: 'POST'
    })
    expect(result).toEqual({ ok: true, wsUrl: 'ws://localhost:3000/hermes/api/ws?ticket=ticket-1' })
  })

  it('does not replace an Electron preload bridge', () => {
    const current = { api: vi.fn() } as unknown as Window['hermesDesktop']
    window.hermesDesktop = current

    installBrowserDesktopBridge()

    expect(window.hermesDesktop).toBe(current)
  })
})
