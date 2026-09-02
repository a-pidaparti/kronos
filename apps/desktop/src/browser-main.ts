import { installBrowserDesktopBridge } from './browser/bridge'

window.__HERMES_BROWSER__ = true
installBrowserDesktopBridge()

void import('./main')
