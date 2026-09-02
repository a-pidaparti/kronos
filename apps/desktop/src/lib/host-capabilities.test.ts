import { afterEach, describe, expect, it } from 'vitest'

import { agentSessionSource, isBrowserHost } from './host-capabilities'

describe('host capabilities', () => {
  afterEach(() => {
    delete window.__HERMES_BROWSER__
  })

  it('keeps the Electron renderer on the desktop session surface', () => {
    expect(isBrowserHost()).toBe(false)
    expect(agentSessionSource()).toBe('desktop')
  })

  it('uses the dashboard session surface in a browser build', () => {
    window.__HERMES_BROWSER__ = true

    expect(isBrowserHost()).toBe(true)
    expect(agentSessionSource()).toBe('dashboard')
  })
})
