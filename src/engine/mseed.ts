/* =====================================================================
 * miniSEED (SEED 2.x) 解析器
 * ---------------------------------------------------------------------
 * 讀取強震觀測站輸出的 miniSEED 檔（例：ExpTech 測站三分量加速度記錄），
 * 依方位碼（Z/N/E）分離為 UD / NS / EW 三分量。
 *
 * 換算：10000 counts = 1 cm/s²（= 1 gal）→ 加速度(gal) = counts / 10000
 *
 * 支援之資料編碼（Blockette 1000 encoding format）：
 *   1  = 16-bit 整數（未壓縮）
 *   3  = 32-bit 整數（未壓縮）   ← 範例檔採用
 *   4  = 32-bit 浮點
 *   5  = 64-bit 浮點
 *   10 = Steim-1 壓縮
 *   11 = Steim-2 壓縮
 * ===================================================================== */

/** counts → gal 換算係數。counts / COUNTS_PER_GAL = 加速度(cm/s²)。 */
export const COUNTS_PER_GAL = 10000

export interface MseedRecord {
  header: {
    type: string
    net: string
    station: string
    loc: string
    origin: string
    fs: number
    channels: Record<string, string> // 分量 → 通道碼（除錯用）
  }
  dt: number
  /** [NS, EW, UD]，單位 gal（cm/s²） */
  acc: [Float64Array, Float64Array, Float64Array]
  n: number
  fmt: "mseed"
}

interface RawRecord {
  net: string
  station: string
  loc: string
  chan: string
  orient: string // 方位碼 Z / N / E …
  t: number // 起始時間（秒，供排序）
  originStr: string
  rate: number
  samples: Int32Array | Float64Array
}

/* ---- 位元擷取（高→低，含號延伸）---- */
function signBits(word: number, hi: number, lo: number): number {
  const width = hi - lo + 1
  const v = (word >>> lo) & ((width === 32 ? 0xffffffff : (1 << width) - 1) >>> 0)
  const sign = 1 << (width - 1)
  return v & sign ? v - (1 << width) : v
}

/* ---- Steim-1 單字解碼 ---- */
function steim1Word(word: number, c: number): number[] {
  switch (c) {
    case 1: // 四個 8-bit 差分
      return [signBits(word, 31, 24), signBits(word, 23, 16), signBits(word, 15, 8), signBits(word, 7, 0)]
    case 2: // 兩個 16-bit 差分
      return [signBits(word, 31, 16), signBits(word, 15, 0)]
    case 3: // 一個 32-bit 差分
      return [word | 0]
    default:
      return []
  }
}

/* ---- Steim-2 單字解碼 ---- */
function steim2Word(word: number, c: number): number[] {
  if (c === 1) {
    return [signBits(word, 31, 24), signBits(word, 23, 16), signBits(word, 15, 8), signBits(word, 7, 0)]
  }
  const dnib = (word >>> 30) & 0x3
  if (c === 2) {
    switch (dnib) {
      case 1:
        return [signBits(word, 29, 0)]
      case 2:
        return [signBits(word, 29, 15), signBits(word, 14, 0)]
      case 3:
        return [signBits(word, 29, 20), signBits(word, 19, 10), signBits(word, 9, 0)]
      default:
        return []
    }
  }
  // c === 3
  switch (dnib) {
    case 0:
      return [
        signBits(word, 29, 24), signBits(word, 23, 18), signBits(word, 17, 12),
        signBits(word, 11, 6), signBits(word, 5, 0),
      ]
    case 1:
      return [
        signBits(word, 29, 25), signBits(word, 24, 20), signBits(word, 19, 15),
        signBits(word, 14, 10), signBits(word, 9, 5), signBits(word, 4, 0),
      ]
    case 2:
      return [
        signBits(word, 27, 24), signBits(word, 23, 20), signBits(word, 19, 16),
        signBits(word, 15, 12), signBits(word, 11, 8), signBits(word, 7, 4), signBits(word, 3, 0),
      ]
    default:
      return []
  }
}

function decodeSteim(
  dv: DataView,
  dataOff: number,
  dataLen: number,
  numSamples: number,
  little: boolean,
  steim2: boolean,
): Int32Array {
  const out = new Int32Array(numSamples)
  const numFrames = Math.floor(dataLen / 64)
  const decodeWord = steim2 ? steim2Word : steim1Word
  let n = 0
  let x0 = 0
  let xn = 0
  for (let f = 0; f < numFrames && n < numSamples; f++) {
    const frameStart = dataOff + f * 64
    const nibbles = dv.getUint32(frameStart, little)
    for (let w = 1; w < 16 && n < numSamples; w++) {
      const c = (nibbles >>> (30 - 2 * w)) & 0x3
      const wordStart = frameStart + w * 4
      const word = dv.getUint32(wordStart, little)
      if (c === 0) {
        // 積分常數：第一格 word1 = x0（首樣本）、word2 = xn（末樣本，供驗證）
        if (f === 0 && w === 1) x0 = word | 0
        else if (f === 0 && w === 2) xn = word | 0
        continue
      }
      const diffs = decodeWord(word, c)
      for (const d of diffs) {
        if (n >= numSamples) break
        if (n === 0) {
          out[0] = x0 // 首樣本 = 前向積分常數；捨棄首個差分
          n = 1
        } else {
          out[n] = out[n - 1] + d
          n++
        }
      }
    }
  }
  // 反向積分常數驗證：若不符，代表解碼有誤，明確拋錯而非回傳亂數
  if (numFrames > 0 && n === numSamples && numSamples > 0 && out[numSamples - 1] !== xn) {
    throw new Error(`Steim 解碼校驗失敗（末樣本 ${out[numSamples - 1]} ≠ 積分常數 ${xn}）`)
  }
  return out
}

function decodeData(
  dv: DataView,
  dataOff: number,
  dataLen: number,
  nsamp: number,
  encoding: number,
  little: boolean,
): Int32Array | Float64Array {
  switch (encoding) {
    case 1: {
      const out = new Int32Array(nsamp)
      for (let i = 0; i < nsamp; i++) out[i] = dv.getInt16(dataOff + i * 2, little)
      return out
    }
    case 3: {
      const out = new Int32Array(nsamp)
      for (let i = 0; i < nsamp; i++) out[i] = dv.getInt32(dataOff + i * 4, little)
      return out
    }
    case 4: {
      const out = new Float64Array(nsamp)
      for (let i = 0; i < nsamp; i++) out[i] = dv.getFloat32(dataOff + i * 4, little)
      return out
    }
    case 5: {
      const out = new Float64Array(nsamp)
      for (let i = 0; i < nsamp; i++) out[i] = dv.getFloat64(dataOff + i * 8, little)
      return out
    }
    case 10:
      return decodeSteim(dv, dataOff, dataLen, nsamp, little, false)
    case 11:
      return decodeSteim(dv, dataOff, dataLen, nsamp, little, true)
    default:
      throw new Error(`不支援的 miniSEED 編碼格式：${encoding}`)
  }
}

const MONTH_DOY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
function doyToMonthDay(year: number, doy: number): [number, number] {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  let m = 11
  for (let i = 1; i < 12; i++) {
    const start = MONTH_DOY[i] + (leap && i >= 2 ? 1 : 0)
    if (doy <= start) {
      m = i - 1
      break
    }
  }
  const start = MONTH_DOY[m] + (leap && m >= 2 ? 1 : 0)
  return [m + 1, doy - start]
}

/** 解析整份 miniSEED 檔（ArrayBuffer）→ 三分量加速度記錄（gal）。 */
export function parseMseed(buffer: ArrayBuffer): MseedRecord {
  const bytes = new Uint8Array(buffer)
  const dv = new DataView(buffer)
  const td = new TextDecoder("ascii")
  const str = (o: number, n: number) => td.decode(bytes.subarray(o, o + n)).trim()

  // 由第一筆的 Blockette 1000 判定記錄長度
  const firstRecLen = readRecLen(dv, str, 0)
  const records: RawRecord[] = []

  for (let off = 0; off + 48 <= bytes.length; ) {
    const recLen = readRecLen(dv, str, off) || firstRecLen
    parseRecord(dv, bytes, str, off, recLen, records)
    off += recLen
  }

  if (!records.length) throw new Error("找不到有效的 miniSEED 資料記錄")

  // 依方位分組並依時間串接
  const groups: Record<string, RawRecord[]> = {}
  for (const r of records) (groups[r.orient] ||= []).push(r)
  for (const k in groups) groups[k].sort((a, b) => a.t - b.t)

  const pick = (orients: string[]): { data: Float64Array; meta?: RawRecord } => {
    for (const o of orients) {
      if (groups[o]?.length) {
        const g = groups[o]
        let total = 0
        for (const r of g) total += r.samples.length
        const out = new Float64Array(total)
        let p = 0
        for (const r of g) {
          for (let i = 0; i < r.samples.length; i++) out[p + i] = r.samples[i] / COUNTS_PER_GAL
          p += r.samples.length
        }
        return { data: out, meta: g[0] }
      }
    }
    return { data: new Float64Array(0) }
  }

  const nsRes = pick(["N", "1", "Y"]) // 南北
  const ewRes = pick(["E", "2", "X"]) // 東西
  const udRes = pick(["Z", "3"]) // 垂直

  const meta = nsRes.meta || ewRes.meta || udRes.meta || records[0]
  const rate = meta.rate || 100

  // 對齊長度：缺分量以零填補至最長者
  const n = Math.max(nsRes.data.length, ewRes.data.length, udRes.data.length)
  if (n < 10) throw new Error("樣本數過少，無法解析")
  const fit = (a: Float64Array): Float64Array => {
    if (a.length === n) return a
    const o = new Float64Array(n)
    o.set(a.subarray(0, Math.min(a.length, n)))
    return o
  }

  const channels: Record<string, string> = {}
  if (nsRes.meta) channels.NS = nsRes.meta.chan
  if (ewRes.meta) channels.EW = ewRes.meta.chan
  if (udRes.meta) channels.UD = udRes.meta.chan

  return {
    header: {
      type: "miniSEED 加速度記錄（三分量）",
      net: meta.net,
      station: meta.station,
      loc: meta.loc,
      origin: meta.originStr,
      fs: rate,
      channels,
    },
    dt: 1 / rate,
    acc: [fit(nsRes.data), fit(ewRes.data), fit(udRes.data)],
    n,
    fmt: "mseed",
  }
}

/** 讀出某筆記錄的記錄長度（由 Blockette 1000 的 2^recLenExp）。 */
function readRecLen(dv: DataView, _str: (o: number, n: number) => string, off: number): number {
  const nblk = dv.getUint8(off + 39)
  let bo = dv.getUint16(off + 46, false)
  for (let i = 0; i < nblk && bo > 0 && off + bo + 7 <= dv.byteLength; i++) {
    const btype = dv.getUint16(off + bo, false)
    const bnext = dv.getUint16(off + bo + 2, false)
    if (btype === 1000) {
      const exp = dv.getUint8(off + bo + 6)
      return 1 << exp
    }
    if (!bnext) break
    bo = bnext
  }
  return 0
}

function parseRecord(
  dv: DataView,
  _bytes: Uint8Array,
  str: (o: number, n: number) => string,
  off: number,
  recLen: number,
  out: RawRecord[],
): void {
  const station = str(off + 8, 5)
  const loc = str(off + 13, 2)
  const chan = str(off + 15, 3)
  const net = str(off + 18, 2)
  const year = dv.getUint16(off + 20, false)
  const doy = dv.getUint16(off + 22, false)
  const hour = dv.getUint8(off + 24)
  const min = dv.getUint8(off + 25)
  const sec = dv.getUint8(off + 26)
  const frac = dv.getUint16(off + 28, false) // 0.0001 秒
  const nsamp = dv.getUint16(off + 30, false)
  const rateFactor = dv.getInt16(off + 32, false)
  const rateMult = dv.getInt16(off + 34, false)
  const dataOff = dv.getUint16(off + 44, false)

  // Blockette 1000：編碼格式與位元組順序
  const nblk = dv.getUint8(off + 39)
  let encoding = 3
  let wordOrder = 1 // 1 = big-endian
  let bo = dv.getUint16(off + 46, false)
  for (let i = 0; i < nblk && bo > 0; i++) {
    const btype = dv.getUint16(off + bo, false)
    const bnext = dv.getUint16(off + bo + 2, false)
    if (btype === 1000) {
      encoding = dv.getUint8(off + bo + 4)
      wordOrder = dv.getUint8(off + bo + 5)
    }
    if (!bnext) break
    bo = bnext
  }
  const little = wordOrder === 0

  let rate: number
  if (rateFactor > 0 && rateMult > 0) rate = rateFactor * rateMult
  else if (rateFactor > 0 && rateMult < 0) rate = -rateFactor / rateMult
  else if (rateFactor < 0 && rateMult > 0) rate = -rateMult / rateFactor
  else if (rateFactor < 0 && rateMult < 0) rate = 1 / (rateFactor * rateMult)
  else rate = 100

  if (nsamp <= 0) return

  const samples = decodeData(dv, off + dataOff, recLen - dataOff, nsamp, encoding, little)

  const t = Date.UTC(year, 0, 1) / 1000 + (doy - 1) * 86400 + hour * 3600 + min * 60 + sec + frac / 10000
  const [mon, day] = doyToMonthDay(year, doy)
  const originStr =
    `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")} ` +
    `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}:` +
    `${String(sec).padStart(2, "0")} UTC`

  out.push({
    net,
    station,
    loc,
    chan,
    orient: chan.slice(-1).toUpperCase() || "?",
    t,
    originStr,
    rate,
    samples,
  })
}
