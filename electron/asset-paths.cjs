const fs = require('node:fs')
const path = require('node:path')

const ASSETS_AUTHORITY = 'assets'

function isInsideRoot(filePath, root) {
  const relative = path.relative(root, filePath)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function sanitizeUrlPath(rawPath) {
  const decoded = decodeURIComponent(rawPath)
  const normalized = path.normalize(decoded).replace(/^[/\\]+/, '')
  if (normalized === '.') {
    return ''
  }
  return normalized
    .split(/[\\/]+/)
    .filter((part) => part && part !== '.' && part !== '..')
    .join(path.sep)
}

function relativePathFromAliyaUrl(requestUrl) {
  const url = new URL(requestUrl)
  const rawParts = []
  if (url.host && url.host.toLowerCase() !== ASSETS_AUTHORITY) {
    rawParts.push(url.host)
  }
  rawParts.push(url.pathname)
  return sanitizeUrlPath(rawParts.join('/'))
}

function firstPathSegment(relativePath) {
  return relativePath.split(/[\\/]+/, 1)[0]
}

function resolveInsideRoot(root, relativePath) {
  const resolved = path.resolve(root, relativePath)
  return isInsideRoot(resolved, root) ? resolved : null
}

function resolveAliyaPath(requestUrl, { publicRoot, distRoot, fileExists = fs.existsSync }) {
  const relativePath = relativePathFromAliyaUrl(requestUrl)
  const publicPath = resolveInsideRoot(publicRoot, relativePath)
  if (!publicPath) {
    return null
  }

  if (firstPathSegment(relativePath) === ASSETS_AUTHORITY) {
    const distAssetPath = resolveInsideRoot(distRoot, relativePath)
    if (distAssetPath && fileExists(distAssetPath)) {
      return distAssetPath
    }
  }

  return publicPath
}

module.exports = {
  isInsideRoot,
  relativePathFromAliyaUrl,
  resolveAliyaPath
}
