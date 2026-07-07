/* =====================================================================
 * 訊號處理（DSP）與建物應答分析
 * ---------------------------------------------------------------------
 * - Butterworth 高通濾波器（依 齋藤1978 遞迴濾波器設計）＋ 梯形積分
 *   fp=0.1Hz, fstop=0.05Hz, Ap=0.1dB, As=10dB
 *   加速度→(HPF)→速度→(HPF)→變位→(HPF) 之多段處理以抑制基線飄移。
 * - 建物應答：多質點剪力型模型之時刻歷應答（Newmark-β 法、Rayleigh 阻尼）。
 * ===================================================================== */

export interface Proc {
  acc: Float64Array[]
  vel: Float64Array[]
  dsp: Float64Array[]
  n: number
  dt: number
  pga: number
  pgv: number
  pgd: number
  dur: number
  bld?: { N: number; floor: number; T1: number; h: number; type: string }
}

interface AccRecord {
  header: { fs?: number }
  dt: number
  acc: Float64Array[]
  n: number
  fmt: string
}

interface Section {
  b: [number, number, number]
  a: [number, number]
}

/** 設計 Butterworth 高通濾波器（回傳二階節）。 */
function designHpf(fsamp: number): Section[] {
  const Ap = 0.1
  const As = 10.0
  const fp = 0.1
  const fstop = 0.05
  const wp = Math.tan((Math.PI * fp) / fsamp)
  const ws = Math.tan((Math.PI * fstop) / fsamp)
  const n = Math.ceil(
    Math.log10((Math.pow(10, As / 10) - 1) / (Math.pow(10, Ap / 10) - 1)) / (2 * Math.log10(wp / ws)),
  )
  const eps = Math.sqrt(Math.pow(10, Ap / 10) - 1)
  const wc = wp * Math.pow(eps, 1 / n)
  const secs: Section[] = []
  for (let k = 0; k < Math.floor(n / 2); k++) {
    const a1 = 2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * n))
    const A = 1 + a1 * wc + wc * wc
    const B = 2 * (wc * wc - 1)
    const C = 1 - a1 * wc + wc * wc
    secs.push({ b: [1 / A, -2 / A, 1 / A], a: [B / A, C / A] })
  }
  if (n % 2) {
    const A = 1 + wc
    secs.push({ b: [1 / A, -1 / A, 0], a: [(wc - 1) / A, 0] })
  }
  return secs
}

function applyFilter(x: Float64Array, secs: Section[]): Float64Array {
  let y = Float64Array.from(x)
  for (const s of secs) {
    const out = new Float64Array(y.length)
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    const [b0, b1, b2] = s.b
    const [a1, a2] = s.a
    for (let i = 0; i < y.length; i++) {
      const xi = y[i]
      const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = xi
      y2 = y1
      y1 = yi
      out[i] = yi
    }
    y = out
  }
  return y
}

function cumTrapz(x: Float64Array, dt: number): Float64Array {
  const y = new Float64Array(x.length)
  for (let i = 1; i < x.length; i++) y[i] = y[i - 1] + (x[i] + x[i - 1]) * 0.5 * dt
  return y
}

/* 氣象廳 積分漸化式（齋藤1978 之係數設計，設計取樣 100Hz）
   速度：截止5秒之3次 Butterworth 積分特性
   變位：1倍強震計特性（固有周期 T0=6s，減衰定數 h=0.55）之漸化式 */
function jmaVel(a: Float64Array): Float64Array {
  const G = 0.004937561699
  const A1 = -2.974867761716
  const A2 = 2.950050339269
  const A3 = -0.975180618018
  const v = new Float64Array(a.length)
  for (let t = 0; t < a.length; t++) {
    const a1 = t > 0 ? a[t - 1] : 0
    const a2 = t > 1 ? a[t - 2] : 0
    const a3 = t > 2 ? a[t - 3] : 0
    const v1 = t > 0 ? v[t - 1] : 0
    const v2 = t > 1 ? v[t - 2] : 0
    const v3 = t > 2 ? v[t - 3] : 0
    v[t] = G * (a[t] - a1 - a2 + a3) - (A1 * v1 + A2 * v2 + A3 * v3)
  }
  return v
}
function jmaDisp(a: Float64Array): Float64Array {
  const H = 1.0
  const C1 = -1.988438073558305
  const C2 = 0.9885471048650272
  const D0 = 0.00002485615736514583
  const D1 = 0.00004971231473029166
  const D2 = 0.00002485615736514583
  const d = new Float64Array(a.length)
  for (let t = 0; t < a.length; t++) {
    const a1 = t > 0 ? a[t - 1] : 0
    const a2 = t > 1 ? a[t - 2] : 0
    const d1 = t > 0 ? d[t - 1] : 0
    const d2 = t > 1 ? d[t - 2] : 0
    d[t] = H * (D0 * a[t] + D1 * a1 + D2 * a2) - (C1 * d1 + C2 * d2)
  }
  return d
}
function resampleLinear(x: Float64Array, dtIn: number, dtOut: number): Float64Array {
  const n = Math.floor(((x.length - 1) * dtIn) / dtOut) + 1
  const y = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = (i * dtOut) / dtIn
    const i0 = Math.min(Math.floor(t), x.length - 2)
    const f = t - i0
    y[i] = x[i0] * (1 - f) + x[i0 + 1] * f
  }
  return y
}

/** 由加速度記錄計算加速度/速度/變位三成分波形。
 *  採氣象廳官方積分漸化式（漸化式係數為 100Hz 設計，故先線性重取樣至 100Hz）。 */
export function processRecord(rec: AccRecord): Proc {
  let dt = rec.dt
  let accIn = rec.acc
  // 漸化式係數為 100Hz 設計 → 非 100Hz 先重取樣
  if (Math.abs(dt - 0.01) > 1e-6) {
    accIn = accIn.map((a) => resampleLinear(a, dt, 0.01))
    dt = 0.01
  }
  const acc: Float64Array[] = []
  const vel: Float64Array[] = []
  const dsp: Float64Array[] = []
  for (let c = 0; c < 3; c++) {
    const raw = accIn[c]
    let m = 0
    for (let i = 0; i < raw.length; i++) m += raw[i]
    m /= raw.length || 1
    const a0 = new Float64Array(raw.length)
    for (let i = 0; i < raw.length; i++) a0[i] = raw[i] - m // 去除平均偏移
    acc.push(a0)
    vel.push(jmaVel(a0)) // 積分漸化式（cm/s）
    dsp.push(jmaDisp(a0)) // 積分漸化式（cm）
  }
  const n = acc[0].length
  let pga = 0
  let pgv = 0
  let pgd = 0
  for (let i = 0; i < n; i++) {
    const A = Math.hypot(acc[0][i], acc[1][i], acc[2][i])
    const V = Math.hypot(vel[0][i], vel[1][i], vel[2][i])
    const D = Math.hypot(dsp[0][i], dsp[1][i], dsp[2][i])
    if (A > pga) pga = A
    if (V > pgv) pgv = V
    if (D > pgd) pgd = D
  }
  return { acc, vel, dsp, n, dt, pga, pgv, pgd, dur: (n - 1) * dt }
}

/* =====================================================================
 * 建物應答 — 多質點剪力型模型之時刻歷應答分析
 *   等質量・等剛性剪力型建物。T₁ 依構造種別略算式（S造0.03H, RC造0.02H,
 *   層高4m）決定剛度 k；阻尼採 Rayleigh 型；Newmark-β 法（β=1/4, γ=1/2）。
 *   K̂ 為三對角矩陣 → Thomas 法每步 O(N)。水平二分量（NS,EW）解析，UD 用地表波。
 * ===================================================================== */
export interface BldCfg {
  on: boolean
  N: number
  floor: number
  type: string
}

export function buildingResponse(pg: Proc, cfg: BldCfg): Proc {
  const N = cfg.N | 0
  const fl = Math.min(Math.max(cfg.floor | 0, 1), N)
  const hgt = 4.0
  const H = hgt * N
  const T1 = (cfg.type === "RC" ? 0.02 : 0.03) * H
  const h = cfg.type === "RC" ? 0.03 : 0.02
  const m = 1.0e6 // 1000 t/層
  const w1 = (2 * Math.PI) / T1
  const k = m * Math.pow(w1 / (2 * Math.sin(Math.PI / (2 * (2 * N + 1)))), 2)
  const w2 = Math.sqrt(k / m) * 2 * Math.sin((3 * Math.PI) / (2 * (2 * N + 1)))
  const a0 = (2 * h * w1 * w2) / (w1 + w2)
  const a1 = (2 * h) / (w1 + w2)
  const dt = pg.dt
  const n = pg.n
  const dK = new Float64Array(N)
  for (let i = 0; i < N; i++) dK[i] = i < N - 1 ? 2 * k : k
  const oK = -k
  const b = 0.25
  const g = 0.5
  const c0 = 1 / (b * dt * dt)
  const c1 = g / (b * dt)
  const c2 = 1 / (b * dt)
  const c3 = 1 / (2 * b) - 1
  const c4 = g / b - 1
  const c5 = dt * (g / (2 * b) - 1)
  const fK = 1 + c1 * a1
  const fM = (c1 * a0 + c0) * m
  const oH = fK * oK
  const dd = new Float64Array(N)
  const cp = new Float64Array(N)
  dd[0] = fK * dK[0] + fM
  cp[0] = oH / dd[0]
  for (let i = 1; i < N; i++) {
    dd[i] = fK * dK[i] + fM - oH * cp[i - 1]
    cp[i] = oH / dd[i]
  }
  const solve = (r: Float64Array, out: Float64Array) => {
    out[0] = r[0] / dd[0]
    for (let i = 1; i < N; i++) out[i] = (r[i] - oH * out[i - 1]) / dd[i]
    for (let i = N - 2; i >= 0; i--) out[i] -= cp[i] * out[i + 1]
  }
  const mulK = (x: Float64Array, y: Float64Array) => {
    for (let i = 0; i < N; i++) {
      let s = dK[i] * x[i]
      if (i > 0) s += oK * x[i - 1]
      if (i < N - 1) s += oK * x[i + 1]
      y[i] = s
    }
  }
  const acc: Float64Array[] = []
  const vel: Float64Array[] = []
  const dsp: Float64Array[] = []
  for (let comp = 0; comp < 2; comp++) {
    const agArr = pg.acc[comp]
    const u = new Float64Array(N)
    const v = new Float64Array(N)
    const a = new Float64Array(N)
    const P = new Float64Array(N)
    const tmp = new Float64Array(N)
    const Kt = new Float64Array(N)
    const un = new Float64Array(N)
    const ag0 = agArr[0] * 0.01 // gal→m/s²
    for (let i = 0; i < N; i++) a[i] = -ag0
    const outA = new Float64Array(n)
    const outV = new Float64Array(n)
    const outD = new Float64Array(n)
    outA[0] = (a[fl - 1] + ag0) * 100
    outV[0] = pg.vel[comp][0]
    outD[0] = pg.dsp[comp][0]
    for (let t = 1; t < n; t++) {
      const ag = agArr[t] * 0.01
      for (let i = 0; i < N; i++) tmp[i] = c1 * u[i] + c4 * v[i] + c5 * a[i]
      mulK(tmp, Kt)
      for (let i = 0; i < N; i++)
        P[i] = -m * ag + m * (c0 * u[i] + c2 * v[i] + c3 * a[i]) + a0 * m * tmp[i] + a1 * Kt[i]
      solve(P, un)
      for (let i = 0; i < N; i++) {
        const an = c0 * (un[i] - u[i]) - c2 * v[i] - c3 * a[i]
        v[i] = v[i] + dt * ((1 - g) * a[i] + g * an)
        u[i] = un[i]
        a[i] = an
      }
      outA[t] = (a[fl - 1] + ag) * 100 // 絕對加速度 gal
      outV[t] = pg.vel[comp][t] + v[fl - 1] * 100 // 絕對速度 cm/s
      outD[t] = pg.dsp[comp][t] + u[fl - 1] * 100 // 絕對變位 cm
    }
    acc.push(outA)
    vel.push(outV)
    dsp.push(outD)
  }
  acc.push(Float64Array.from(pg.acc[2])) // UD 用地表波
  vel.push(Float64Array.from(pg.vel[2]))
  dsp.push(Float64Array.from(pg.dsp[2]))
  let pga = 0
  let pgv = 0
  let pgd = 0
  for (let i = 0; i < n; i++) {
    const A = Math.hypot(acc[0][i], acc[1][i], acc[2][i])
    const V = Math.hypot(vel[0][i], vel[1][i], vel[2][i])
    const D = Math.hypot(dsp[0][i], dsp[1][i], dsp[2][i])
    if (A > pga) pga = A
    if (V > pgv) pgv = V
    if (D > pgd) pgd = D
  }
  return {
    acc,
    vel,
    dsp,
    n,
    dt,
    pga,
    pgv,
    pgd,
    dur: pg.dur,
    bld: { N, floor: fl, T1, h, type: cfg.type },
  }
}

/** 由方向、周期、最大變位、持續時間生成正弦波加振記錄。 */
export function generateSine(dir: "NS" | "EW", T: number, A: number, dur: number): Proc {
  const dt = 0.01
  const n = Math.round(dur / dt) + 1
  const w = (2 * Math.PI) / T
  const ci = dir === "NS" ? 0 : 1
  const dsp = [0, 1, 2].map(() => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    const t = i * dt
    const env = Math.max(0, Math.min(1, t / (2 * T), (dur - t) / (2 * T))) // 兩端2周期漸變
    dsp[ci][i] = A * env * Math.sin(w * t)
  }
  const diff = (arr: Float64Array): Float64Array => {
    const o = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const hi = Math.min(i + 1, n - 1)
      const lo = Math.max(i - 1, 0)
      o[i] = (arr[hi] - arr[lo]) / ((hi - lo) * dt)
    }
    return o
  }
  const vel = dsp.map(diff)
  const acc = vel.map(diff)
  let pga = 0
  let pgv = 0
  let pgd = 0
  for (let i = 0; i < n; i++) {
    pga = Math.max(pga, Math.abs(acc[ci][i]))
    pgv = Math.max(pgv, Math.abs(vel[ci][i]))
    pgd = Math.max(pgd, Math.abs(dsp[ci][i]))
  }
  return { acc, vel, dsp, n, dt, dur: (n - 1) * dt, pga, pgv, pgd }
}
