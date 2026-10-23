// Writes PAYLOAD_MIB of random, incompressible files into payload/. Fresh bytes on every run, so
// the server never already holds them and every deploy uploads the full payload.
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MIB = 1024 * 1024
const totalMiB = Number(process.env.PAYLOAD_MIB ?? 64)
const fileMiB = Number(process.env.PAYLOAD_FILE_MIB ?? 4)
if (!Number.isInteger(totalMiB) || !Number.isInteger(fileMiB) || totalMiB < 1 || fileMiB < 1) {
  throw new Error('PAYLOAD_MIB and PAYLOAD_FILE_MIB must be positive integers')
}

const dir = join(import.meta.dirname, '..', 'payload')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir)

const count = Math.ceil(totalMiB / fileMiB)
for (let i = 0; i < count; i++) {
  const size = Math.min(fileMiB, totalMiB - i * fileMiB) * MIB
  writeFileSync(join(dir, `chunk-${String(i).padStart(3, '0')}.bin`), randomBytes(size))
}
console.log(`payload: ${count} files, ${totalMiB} MiB in ${dir}`)
