// Generates the app icons from the glyph of public/favicon.svg (the same "P" as src/ui/BrandMark.tsx). The PNGs are
// committed (the build does not run this); run `npm run gen:icons` only when the glyph or the colors change.
//
// "Clínico claro": a petrol-blue "P" (--accent) on an ice-white tile (--page), with a hairline (--line) where the tile
// meets a light background.
//
//   public/pwa-192.png, pwa-512.png        "any" purpose: rounded tile
//   public/pwa-maskable-512.png            "maskable": full bleed, glyph inside the central 80% safe zone
//   public/apple-touch-icon.png (180)      iOS rounds it itself, so it is full bleed too
//   public/badge-96.png                    notification badge (Android status bar): the glyph alone, white on
//                                          transparent; the system only uses its alpha
//   android/.../mipmap-*/ic_launcher*.png  legacy launcher icons (Android 7, before adaptive icons): rounded tile, round
//                                          tile and the foreground layer. Android 8+ uses the adaptive icon instead
//                                          (res/mipmap-anydpi-v26: @color/ic_launcher_background +
//                                          @drawable/ic_protocol_foreground, which draw the same colors and glyph).
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'public')
const res = resolve(root, 'android/app/src/main/res')
mkdirSync(out, { recursive: true })

const BACKGROUND = '#f6f7f9'
const HAIRLINE = '#e2e8f0'
const ACCENT = '#0b5e73'
// The "P" of favicon.svg (32x32 box); its bounding box is about x 9..22, y 8..24, centered at (15.5, 16).
const GLYPH = 'M9 8h8a5 5 0 0 1 0 10h-4v6H9z M13 12v2h4a1 1 0 0 0 0-2z'

const glyphAt = (scale, fill) =>
  `<path transform="translate(256 256) scale(${scale}) translate(-15.5 -16)" d="${GLYPH}" fill="${fill}" fill-rule="evenodd"/>`

/** 512x512 artwork: the glyph centered and scaled, on a tile with the given corner radius (a hairline when rounded). */
function artwork({ radius, scale }) {
  const tile =
    radius > 0
      ? `<rect x="4" y="4" width="504" height="504" rx="${radius - 4}" fill="${BACKGROUND}" stroke="${HAIRLINE}" stroke-width="8"/>`
      : `<rect width="512" height="512" fill="${BACKGROUND}"/>`
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${tile}${glyphAt(scale, ACCENT)}</svg>`)
}

const rounded = artwork({ radius: 112, scale: 14 })
const fullBleed = artwork({ radius: 0, scale: 14 })
const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glyphAt(22, '#ffffff')}</svg>`)
const round = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<circle cx="256" cy="256" r="252" fill="${BACKGROUND}" stroke="${HAIRLINE}" stroke-width="8"/>${glyphAt(13, ACCENT)}</svg>`,
)
// The adaptive foreground layer (108dp, the glyph inside the central 66dp): the glyph alone on transparent.
const foreground = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${glyphAt(11.8, ACCENT)}</svg>`)

const targets = [
  [resolve(out, 'pwa-192.png'), rounded, 192],
  [resolve(out, 'pwa-512.png'), rounded, 512],
  [resolve(out, 'pwa-maskable-512.png'), fullBleed, 512],
  [resolve(out, 'apple-touch-icon.png'), fullBleed, 180],
  [resolve(out, 'badge-96.png'), badge, 96],
]

// Legacy launcher sizes: 48dp icon and 108dp foreground per density.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [density, factor] of Object.entries(DENSITIES)) {
  const dir = resolve(res, `mipmap-${density}`)
  targets.push(
    [resolve(dir, 'ic_launcher.png'), rounded, 48 * factor],
    [resolve(dir, 'ic_launcher_round.png'), round, 48 * factor],
    [resolve(dir, 'ic_launcher_foreground.png'), foreground, 108 * factor],
  )
}

for (const [path, svg, size] of targets) {
  mkdirSync(dirname(path), { recursive: true })
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(path)
  console.log(`${path.slice(root.length + 1)} (${size}x${size})`)
}
