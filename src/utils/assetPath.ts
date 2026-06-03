const ELECTRON_PROTOCOL = 'aliya://assets'

export function assetPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '')
  if (window.location.protocol === 'file:') {
    return `${ELECTRON_PROTOCOL}/${normalized}`
  }
  return `/${normalized}`
}
