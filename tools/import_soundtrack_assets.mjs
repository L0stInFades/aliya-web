import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const sourceRoot = 'E:\\SteamLibrary\\steamapps\\music\\AliyaSoundtrack'
const publicRoot = path.join(root, 'public')
const targetRoot = path.join(publicRoot, 'soundtrack')
const manifestPath = path.join(publicRoot, 'soundtrack', 'manifest.json')

const cgMappings = [
  ['1', 'CG/CG01.png'],
  ['2', 'CG/CG02.png'],
  ['4', 'CG/CG03.png'],
  ['3', 'CG/CG04.png'],
  ['6', 'CG/CG05.png'],
  ['5', 'CG/CG06.jpg'],
  ['7', 'CG/CG07.png'],
  ['8', 'CG/CG08.png'],
  ['9', 'CG/CG09.png'],
  ['10', 'CG/CG10.png'],
  ['11', 'CG/CG11.png'],
  ['12', 'CG/CG12.png'],
  ['13', 'CG/CG13.png'],
  ['14', 'CG/CG14.png'],
  ['15', 'CG/CG15.png'],
  ['16', 'CG/CG16.png']
]

const musicTracks = [
  ['Aliya', 'MP3/1.Aliya.mp3'],
  ['Drift', 'MP3/2.Drift.mp3'],
  ['Response', 'MP3/3.Response.mp3'],
  ['Letter', 'MP3/4.Letter.mp3'],
  ['Astral Sunset', 'MP3/5.Astral Sunset.mp3'],
  ["Stars' Annihilation", "MP3/6.Stars' Annihilation.mp3"],
  ['Tranquil Repose', 'MP3/7.Tranquil Repose.mp3']
]

const wallpaperFiles = [
  'Wallpaper/1400x2810.png',
  'Wallpaper/3240x5760.jpg',
  'Wallpaper/3840x2160.png',
  'Wallpaper/5760x3240_CN.jpg',
  'Wallpaper/5760x3240_EN.jpg'
]

function copyAsset(relativeSource, relativeTarget) {
  const source = path.join(sourceRoot, relativeSource)
  const target = path.join(targetRoot, relativeTarget)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  const stat = fs.statSync(target)
  return {
    source,
    path: `soundtrack/${relativeTarget.replaceAll('\\', '/')}`,
    bytes: stat.size
  }
}

const cg = {}
for (const [imageId, relativeSource] of cgMappings) {
  const ext = path.extname(relativeSource)
  cg[imageId] = copyAsset(relativeSource, `CG/${imageId}${ext}`)
}

const music = {}
for (const [trackId, relativeSource] of musicTracks) {
  const fileName = path.basename(relativeSource)
  music[trackId] = copyAsset(relativeSource, `music/${fileName}`)
}

const wallpapers = wallpaperFiles.map((relativeSource) =>
  copyAsset(relativeSource, `wallpaper/${path.basename(relativeSource)}`)
)

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceRoot,
  mappingEvidence: {
    method: 'CG files were matched against extracted game message images by dimensions and 16x16 grayscale hash. Exact or nearest matches are recorded as gameImageId -> soundtrack CG.',
    imageIds: Object.fromEntries(cgMappings.map(([imageId, relativeSource]) => [imageId, relativeSource]))
  },
  cg,
  music,
  wallpapers
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`wrote ${manifestPath}`)
console.log(`cg=${Object.keys(cg).length}, music=${Object.keys(music).length}, wallpapers=${wallpapers.length}`)
