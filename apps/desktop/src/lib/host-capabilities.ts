export function isBrowserHost(): boolean {
  return typeof window !== 'undefined' && window.__HERMES_BROWSER__ === true
}

export function agentSessionSource(): 'dashboard' | 'desktop' {
  return isBrowserHost() ? 'dashboard' : 'desktop'
}
