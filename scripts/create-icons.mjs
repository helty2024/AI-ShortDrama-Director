import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
const source = new URL('../build/icon.svg', import.meta.url)
const sizes = [16, 32, 48, 64, 128, 256]
const images = await Promise.all(
  sizes.map((size) =>
    sharp(fileURLToPath(source)).resize(size, size).png().toBuffer(),
  ),
)
const header = Buffer.alloc(6 + 16 * sizes.length)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
images.forEach((data, i) => {
  const entry = 6 + i * 16
  header[entry] = sizes[i] === 256 ? 0 : sizes[i]
  header[entry + 1] = header[entry]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(data.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += data.length
})
await writeFile(
  new URL('../build/icon.ico', import.meta.url),
  Buffer.concat([header, ...images]),
)
await writeFile(new URL('../build/icon.png', import.meta.url), images.at(-1))
