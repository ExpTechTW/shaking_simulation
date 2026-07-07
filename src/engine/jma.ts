/* =====================================================================
 * 氣象廳（JMA）計測震度計算
 * 依 https://www.jma.go.jp/jma/kishou/know/jishin/kyoshin/kaisetsu/calc_sindo.html
 * ---------------------------------------------------------------------
 * 對三分量加速度（gal）於頻域套用 JMA 濾波器（週期效應×高域遮斷×低域遮斷），
 * 反轉換回時域取向量合成 a(t)，求「合計 0.3 秒以上超過的加速度 a0」，
 * 計測震度 I = 2·log10(a0) + 0.94。
 * ===================================================================== */

function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2
        const vr = re[b] * cr - im[b] * ci
        const vi = re[b] * ci + im[b] * cr
        re[b] = re[a] - vr; im[b] = im[a] - vi
        re[a] += vr; im[a] += vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

/** JMA 濾波器 G(f)＝週期效應 × 高域遮斷 × 低域遮斷 */
function jmaFilter(f: number): number {
  if (f <= 0) return 0
  const gp = Math.sqrt(1 / f) // 週期效應
  const y = f / 10 // 高域遮斷（fc=10Hz）
  const gh = Math.pow(
    1 + 0.694 * y ** 2 + 0.241 * y ** 4 + 0.0557 * y ** 6 + 0.009664 * y ** 8 + 0.00134 * y ** 10 + 0.000155 * y ** 12,
    -0.5,
  )
  const gl = Math.sqrt(1 - Math.exp(-((f / 0.5) ** 3))) // 低域遮斷（fl=0.5Hz）
  return gp * gh * gl
}

export interface JmaResult {
  I: number // 計測震度（小數第2位截斷）
  shindo: string // 震度階級（"0"〜"7"，含"5弱"等）
  a0: number // 對應加速度（gal）
}

/** 由計測震度 I 對應震度階級 */
export function shindoClass(I: number): string {
  if (I < 0.5) return "0"
  if (I < 1.5) return "1"
  if (I < 2.5) return "2"
  if (I < 3.5) return "3"
  if (I < 4.5) return "4"
  if (I < 5.0) return "5弱"
  if (I < 5.5) return "5強"
  if (I < 6.0) return "6弱"
  if (I < 6.5) return "6強"
  return "7"
}

/** 計算三分量加速度（gal）之 JMA 計測震度 */
export function computeJmaIntensity(acc: Float64Array[], fs: number): JmaResult {
  const n = acc[0].length
  if (n < 8) return { I: 0, shindo: "0", a0: 0 }
  let N = 1
  while (N < n) N <<= 1
  const df = fs / N
  const filtered: Float64Array[] = []
  for (let c = 0; c < 3; c++) {
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    let m = 0
    for (let i = 0; i < n; i++) m += acc[c][i]
    m /= n
    for (let i = 0; i < n; i++) re[i] = acc[c][i] - m
    fft(re, im)
    for (let k = 0; k < N; k++) {
      const f = k <= N / 2 ? k * df : (N - k) * df
      const g = jmaFilter(f)
      re[k] *= g
      im[k] *= g
    }
    fft(re, im, true)
    filtered.push(re.slice(0, n))
  }
  const mag = new Float64Array(n)
  for (let i = 0; i < n; i++) mag[i] = Math.hypot(filtered[0][i], filtered[1][i], filtered[2][i])
  const sorted = Array.from(mag).sort((a, b) => b - a)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(0.3 * fs) - 1))
  const a0 = sorted[idx]
  // JMA 官方為「切り捨て（向零截斷）」至小數第 2 位
  const I = a0 > 0 ? Math.trunc((2 * Math.log10(a0) + 0.94) * 100) / 100 : 0
  return { I, shindo: shindoClass(I), a0 }
}
