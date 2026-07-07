// @ts-nocheck
/* =====================================================================
 * SimEngine — 與框架無關的模擬引擎
 * ---------------------------------------------------------------------
 * 擁有 Three.js 場景、Cannon-es 物理世界、波形處理、物理迴圈與波形/軌跡
 * /HUD 之 Canvas 繪製。由 React 透過方法驅動，並以訂閱機制回報離散狀態。
 * 逐幀熱路徑（時間、加速度 HUD、狀態列）直接寫入 React 提供的 DOM ref，
 * 避免每秒 60 次的 React 重繪。
 * ===================================================================== */
import * as THREE from "three"
import * as CANNON from "cannon-es"
import { SCENES } from "./furniture"
import { processRecord, buildingResponse, generateSine } from "./dsp"
import { parseMseed } from "./mseed"
import { computeJmaIntensity } from "./jma"

THREE.ColorManagement.enabled = false // 貼近原始 r128 的平面配色觀感

const PHYS_DT = 1 / 240
const WALL_T = 0.08
const MUS_OVER_MUK = 1.3
const CONTACT_GRACE = 4
const VY_AIRBORNE = 0.35
const compColors = ["#5aa2ff", "#3ddc97", "#aab4c4"]

export interface RecordInfo {
  fileName: string
  type: string
  station?: string
  net?: string
  loc?: string
  origin?: string
  dur: number
  fs: number
  channels?: Record<string, string>
  isSine?: boolean
  sine?: { dir: string; T: number; A: number; peakGal: number }
  intensity?: { I: number; shindo: string; a0: number }
}

export interface StatusRow {
  name: string
  state: string
  cls: "fall" | "slide" | "ok"
}

export interface FurnUIState {
  on: boolean
  mass: number
  cog: number
  lamp: boolean
}

export interface FurnDefUI {
  id: string
  name: string
  unitCount: number
  spec: string
  lamp: boolean
  h?: number
}

export interface EngineState {
  sceneKey: string
  sceneLabel: string
  hasProc: boolean
  running: boolean
  dur: number
  startSkip: number
  ampScale: number
  speed: number
  swap: boolean
  waveView: "full" | "win"
  waveOpen: boolean
  orbitOpen: boolean
  record: RecordInfo | null
  peaks: { pga: number; pgv: number; pgd: number; tag: string } | null
  bld: { on: boolean; N: number; floor: number; type: string }
  bldInfo: string
  furnDefs: FurnDefUI[]
  furn: Record<string, FurnUIState>
  message: string
  msgId: number
}

export interface LiveRefs {
  timeEl: HTMLElement | null
  accEl: HTMLElement | null
  statusEl: HTMLElement | null
}

export class SimEngine {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private world: CANNON.World
  private roomBody: CANNON.Body | null = null
  private roomGroup: THREE.Group | null = null
  private floorMat = new CANNON.Material("floor")
  private _matCache: Record<string, CANNON.Material> = {}
  private furniture: any[] = []

  private proc: any = null
  private procGround: any = null
  private simT = 0
  private physT = 0
  running = false

  private ROOM_W = 4.2
  private ROOM_D = 4.2
  private ROOM_H = 2.4
  private roomOffset = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 }
  private _pose = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, ax: 0, ay: 0, az: 0 }

  // 相機
  private camTheta = 0.8
  private camPhi = 1.15
  private camDist = 8.2
  private camTarget = new THREE.Vector3(0, 1.0, 0)

  // 設定（由 React 設定）
  sceneKey = "home"
  ampScale = 1
  speed = 1
  startSkip = 10
  swap = false
  waveView: "full" | "win" = "full"
  waveOpen = true
  orbitOpen = false
  bld = { on: false, N: 20, floor: 20, type: "S" }
  furn: Record<string, FurnUIState> = {}

  // Canvas / DOM refs
  private chartCanvases: HTMLCanvasElement[] | null = null
  private orbitCanvas: HTMLCanvasElement | null = null
  private liveRefs: LiveRefs = { timeEl: null, accEl: null, statusEl: null }

  // 繪製快取
  private staticCache: ImageData[] | null = null
  private orbitCache: ImageData | null = null
  private cursorPrev = -1

  private recordInfo: RecordInfo | null = null
  private peaks: EngineState["peaks"] = null
  private bldInfo = ""
  private message = ""
  private msgId = 0

  private listeners = new Set<(s: EngineState) => void>()
  private _raf = 0
  private _lastFrame = 0
  private _disposed = false
  private _onResize = () => this.onResize()
  private _placeQueued = false

  constructor(container: HTMLElement) {
    this.container = container
    this.initFurnState(this.sceneKey)
    this.initGL()
    this.initPhysics()
    this.placeFurniture()
    this._lastFrame = performance.now()
    this._raf = requestAnimationFrame((ts) => this.loop(ts))
  }

  /* ------------------------------------------------------------------ 訂閱 */
  subscribe(cb: (s: EngineState) => void): () => void {
    this.listeners.add(cb)
    cb(this.getState())
    return () => this.listeners.delete(cb)
  }
  private emit() {
    const s = this.getState()
    for (const cb of this.listeners) cb(s)
  }
  getState(): EngineState {
    const sc = SCENES[this.sceneKey]
    return {
      sceneKey: this.sceneKey,
      sceneLabel: sc.label,
      hasProc: !!this.proc,
      running: this.running,
      dur: this.proc ? this.proc.dur : 0,
      startSkip: this.startSkip,
      ampScale: this.ampScale,
      speed: this.speed,
      swap: this.swap,
      waveView: this.waveView,
      waveOpen: this.waveOpen,
      orbitOpen: this.orbitOpen,
      record: this.recordInfo,
      peaks: this.peaks,
      bld: { ...this.bld },
      bldInfo: this.bldInfo,
      furnDefs: this.furnDefsUI(),
      furn: this.furn,
      message: this.message,
      msgId: this.msgId,
    }
  }
  private flash(t: string) {
    this.message = t
    this.msgId++
    this.emit()
  }

  /* ---------------------------------------------------------- 家具 UI 狀態 */
  private initFurnState(key: string) {
    const next: Record<string, FurnUIState> = {}
    for (const def of SCENES[key].furn) {
      next[def.id] = { on: !!def.on, mass: def.mass, cog: 50, lamp: !!def.lamp }
    }
    this.furn = next
  }
  private furnDefsUI(): FurnDefUI[] {
    return SCENES[this.sceneKey].furn.map((f: any) => {
      const n = f.units ? f.units.length : 1
      const spec = f.lamp ? `繩長 ${f.cord}m` : `${f.h}m / μ${f.mu}`
      return { id: f.id, name: f.name, unitCount: n, spec, lamp: !!f.lamp, h: f.h }
    })
  }
  private furnCfg(def: any) {
    const st = this.furn[def.id] || { mass: def.mass, cog: 50 }
    const mass = Math.max(0.5, st.mass || def.mass)
    if (def.lamp) return { mass, cogY: 0 }
    const r = Math.min(0.9, Math.max(0.1, (st.cog || 50) / 100))
    return { mass, cogY: def.h * r }
  }

  /* ------------------------------------------------------------ Three.js */
  private initGL() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0e1116)
    this.scene.fog = new THREE.Fog(0x0e1116, 10, 26)
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)

    const amb = new THREE.HemisphereLight(0xbcc7d6, 0x20242c, 0.75)
    this.scene.add(amb)
    const sun = new THREE.DirectionalLight(0xffffff, 0.9)
    sun.position.set(5, 8, 4)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -6
    sun.shadow.camera.right = 6
    sun.shadow.camera.top = 6
    sun.shadow.camera.bottom = -6
    this.scene.add(sun)

    const grid = new THREE.GridHelper(30, 30, 0x2a3442, 0x1a212b)
    grid.position.y = -0.35
    this.scene.add(grid)

    this.onResize()
    addEventListener("resize", this._onResize)
    this.initOrbit()
    this.updateCam()
  }
  private onResize() {
    const w = this.container.clientWidth || innerWidth
    const h = this.container.clientHeight || innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.sizeCharts()
    this.staticCache = null
    if (this.proc) this.drawChartsBase()
  }
  private updateCam() {
    const t = this.camTarget
    this.camera.position.set(
      t.x + this.camDist * Math.sin(this.camPhi) * Math.cos(this.camTheta),
      t.y + this.camDist * Math.cos(this.camPhi),
      t.z + this.camDist * Math.sin(this.camPhi) * Math.sin(this.camTheta),
    )
    this.camera.lookAt(t)
  }
  private initOrbit() {
    const el = this.renderer.domElement
    let drag = false
    let px = 0
    let py = 0
    el.addEventListener("pointerdown", (e: PointerEvent) => {
      drag = true
      px = e.clientX
      py = e.clientY
    })
    addEventListener("pointerup", () => (drag = false))
    addEventListener("pointermove", (e: PointerEvent) => {
      if (!drag) return
      this.camTheta += (e.clientX - px) * 0.006
      this.camPhi -= (e.clientY - py) * 0.006
      this.camPhi = Math.max(0.15, Math.min(1.55, this.camPhi))
      px = e.clientX
      py = e.clientY
      this.updateCam()
    })
    el.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        this.camDist = Math.max(3, Math.min(20, this.camDist + e.deltaY * 0.005))
        this.updateCam()
      },
      { passive: true },
    )
  }

  /* -------------------------------------------------------------- Cannon */
  private initPhysics() {
    this.world = new CANNON.World()
    this.world.gravity.set(0, -9.81, 0)
    this.world.broadphase = new CANNON.SAPBroadphase(this.world)
    this.world.solver.iterations = 40
    this.world.defaultContactMaterial.contactEquationStiffness = 2e7
    this.world.defaultContactMaterial.contactEquationRelaxation = 4
    this.world.defaultContactMaterial.frictionEquationStiffness = 1e8
    this.buildRoom()
  }
  private buildRoom() {
    const sc = SCENES[this.sceneKey]
    this.ROOM_W = sc.W
    this.ROOM_D = sc.D
    this.ROOM_H = sc.H
    const W = this.ROOM_W
    const D = this.ROOM_D
    const H = this.ROOM_H
    if (this.roomBody) {
      this.world.removeBody(this.roomBody)
      this.roomBody = null
    }
    if (this.roomGroup) {
      this.scene.remove(this.roomGroup)
      this.roomGroup = null
    }
    this.roomBody = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.floorMat })
    this.roomBody.addShape(new CANNON.Box(new CANNON.Vec3(W / 2, 0.175, D / 2)), new CANNON.Vec3(0, -0.175, 0))
    const wh = H / 2
    this.roomBody.addShape(new CANNON.Box(new CANNON.Vec3(W / 2, wh, WALL_T / 2)), new CANNON.Vec3(0, wh, -D / 2 - WALL_T / 2))
    this.roomBody.addShape(new CANNON.Box(new CANNON.Vec3(W / 2, wh, WALL_T / 2)), new CANNON.Vec3(0, wh, D / 2 + WALL_T / 2))
    this.roomBody.addShape(new CANNON.Box(new CANNON.Vec3(WALL_T / 2, wh, D / 2)), new CANNON.Vec3(-W / 2 - WALL_T / 2, wh, 0))
    this.roomBody.addShape(new CANNON.Box(new CANNON.Vec3(WALL_T / 2, wh, D / 2)), new CANNON.Vec3(W / 2 + WALL_T / 2, wh, 0))
    this.roomBody.addShape(new CANNON.Box(new CANNON.Vec3(W / 2, 0.06, D / 2)), new CANNON.Vec3(0, H + 0.06, 0))
    this.world.addBody(this.roomBody)

    const roomGroup = new THREE.Group()
    this.scene.add(roomGroup)
    this.roomGroup = roomGroup
    const fl = new THREE.Mesh(new THREE.BoxGeometry(W, 0.35, D), new THREE.MeshStandardMaterial({ color: sc.base, roughness: 0.9 }))
    fl.position.y = -0.175
    fl.receiveShadow = true
    roomGroup.add(fl)
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: sc.floor, roughness: 0.95 }))
    top.rotation.x = -Math.PI / 2
    top.position.y = 0.001
    top.receiveShadow = true
    roomGroup.add(top)
    if (sc.tile > 0) {
      const pts: THREE.Vector3[] = []
      for (let x = -W / 2 + sc.tile; x < W / 2 - 1e-6; x += sc.tile) pts.push(new THREE.Vector3(x, 0.003, -D / 2), new THREE.Vector3(x, 0.003, D / 2))
      for (let z = -D / 2 + sc.tile; z < D / 2 - 1e-6; z += sc.tile) pts.push(new THREE.Vector3(-W / 2, 0.003, z), new THREE.Vector3(W / 2, 0.003, z))
      roomGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x878d95, transparent: true, opacity: 0.5 })))
    }
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
    const wN = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat)
    wN.position.set(0, H / 2, -D / 2)
    roomGroup.add(wN)
    const wW = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat)
    wW.rotation.y = Math.PI / 2
    wW.position.set(-W / 2, H / 2, 0)
    roomGroup.add(wW)
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: 0x4a5a70 }))
    frame.position.y = H / 2
    roomGroup.add(frame)
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(W / 2 + 0.5, 0.02, 0), 0.7, 0x5aa2ff, 0.2, 0.12)
    roomGroup.add(arrow)
  }

  /* ---------------------------------------------------- 家具建構共用工具 */
  private stdMat(color: number, rough?: number) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough ?? 0.8 })
  }
  private edged(mesh: THREE.Mesh) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    const g = new THREE.Group()
    g.add(mesh)
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x11151a })))
    g.position.copy(mesh.position)
    mesh.position.set(0, 0, 0)
    return g
  }
  private furnPhysMat(def: any) {
    const key = def.id + "_" + def.mu
    if (!this._matCache[key]) {
      const m = new CANNON.Material(key)
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(this.floorMat, m, {
          friction: def.mu,
          restitution: 0.0,
          frictionEquationStiffness: 1e8,
          frictionEquationRelaxation: 3,
          contactEquationStiffness: 2e7,
          contactEquationRelaxation: 4,
        }),
      )
      this._matCache[key] = m
    }
    return this._matCache[key]
  }
  private newBody(def: any, centerY: number, mass: number) {
    const mat = this.furnPhysMat(def)
    const body = new CANNON.Body({ mass: mass ?? def.mass, material: mat })
    body.position.set(def.pos[0] + this.roomOffset.px, centerY + (def.y0 || 0) + 0.002 + this.roomOffset.py, def.pos[1] + this.roomOffset.pz)
    // 注意：face 旋轉須在所有 addShape 之後才設定（見 finishFurn）。
    // cannon-es 的 updateMassProperties 由世界座標 AABB 推算慣量，若在加入 shape
    // 前先旋轉，90°/270° 會使 w≠d 家具的水平主慣量 Ixx↔Izz 對調而錯誤。
    body.velocity.set(this.roomOffset.vx, this.roomOffset.vy, this.roomOffset.vz)
    body.linearDamping = 0.01
    body.angularDamping = 0.01
    body.allowSleep = false
    return body
  }
  private finishFurn(def: any, body: CANNON.Body, g: THREE.Group) {
    // 所有 shape 已加入 → 此時才設 face 旋轉，確保 body 本體慣量以未旋轉幾何計算
    // （正確），再由 cannon 每步 updateInertiaWorld 轉入世界座標。
    if (def.face) body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), (def.face * Math.PI) / 2)
    this.world.addBody(body)
    this.scene.add(g)
    return {
      def,
      body,
      mesh: g,
      startPos: new CANNON.Vec3(def.pos[0], body.position.y - this.roomOffset.py, def.pos[1]),
      fallen: false,
      slid: false,
      stuck: true,
    }
  }

  private makeBoxFurn(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const S = (c: number, r?: number) => this.stdMat(c, r)
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, def.h / 2, def.d / 2)), new CANNON.Vec3(0, def.h / 2 - cY, 0))
    const g = new THREE.Group()
    if (def.id === "shelftop") {
      const prof = [[0.045, 0], [0.055, 0.03], [0.05, 0.09], [0.026, 0.15], [0.03, 0.19], [0.036, 0.21]]
      for (let i = 0; i < prof.length - 1; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(prof[i + 1][0], prof[i][0], prof[i + 1][1] - prof[i][1], 14), S(def.color, 0.35))
        seg.position.y = (prof[i][1] + prof[i + 1][1]) / 2 - cY
        seg.castShadow = true
        g.add(seg)
      }
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.14, 5), S(0x4a7a3a, 0.8))
        st.position.set(Math.cos(a) * 0.012, 0.26 - cY, Math.sin(a) * 0.012)
        st.rotation.z = Math.cos(a) * 0.25
        st.rotation.x = Math.sin(a) * 0.25
        g.add(st)
        const flw = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), S([0xd46a8a, 0xe0c050, 0xc0d0e8][k], 0.9))
        flw.position.set(Math.cos(a) * 0.03, 0.33 - cY, Math.sin(a) * 0.03)
        g.add(flw)
      }
    } else if (def.id === "deskbooks") {
      const cov = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, def.d), S(def.color, 0.75))
      cov.position.y = def.h / 2 - cY
      g.add(this.edged(cov))
      const pg = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.96, def.h * 0.8, def.d * 1.01), S(0xf2eee2, 0.95))
      pg.position.set(def.w * 0.03, def.h / 2 - cY, 0)
      g.add(pg)
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.012, def.h * 1.01, def.d * 1.01), S(def.color, 0.7))
      sp.position.set(-def.w / 2 + 0.006, def.h / 2 - cY, 0)
      g.add(sp)
    } else if (def.id === "clock") {
      const bodyR = def.h * 0.42
      const dr = new THREE.Mesh(new THREE.CylinderGeometry(bodyR, bodyR, def.d * 0.8, 20), S(def.color, 0.5))
      dr.rotation.x = Math.PI / 2
      dr.position.y = bodyR + 0.02 - cY
      dr.castShadow = true
      g.add(dr)
      const face = new THREE.Mesh(new THREE.CylinderGeometry(bodyR * 0.82, bodyR * 0.82, 0.004, 20), S(0xf5f2e8, 0.9))
      face.rotation.x = Math.PI / 2
      face.position.set(0, bodyR + 0.02 - cY, def.d * 0.4)
      g.add(face)
      const hh = new THREE.Mesh(new THREE.BoxGeometry(0.004, bodyR * 0.5, 0.003), S(0x22262c, 0.4))
      hh.position.set(0, bodyR + 0.02 + bodyR * 0.12 - cY, def.d * 0.4 + 0.004)
      hh.rotation.z = -0.9
      g.add(hh)
      const mh = new THREE.Mesh(new THREE.BoxGeometry(0.003, bodyR * 0.68, 0.003), S(0x22262c, 0.4))
      mh.position.set(0, bodyR + 0.02 + bodyR * 0.16 - cY, def.d * 0.4 + 0.004)
      mh.rotation.z = 0.5
      g.add(mh)
      for (const sx of [-1, 1]) {
        const bell = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), S(0xd8b040, 0.4))
        bell.position.set(sx * bodyR * 0.55, bodyR * 2 + 0.028 - cY, 0)
        g.add(bell)
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.024, 6), S(0x30363e, 0.4))
        leg.position.set(sx * bodyR * 0.6, 0.012 - cY, def.d * 0.15)
        leg.rotation.z = -sx * 0.3
        g.add(leg)
      }
    } else if (def.id === "chesttop") {
      const fw = def.w
      const fh = def.h
      const ft = 0.012
      const frame = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, ft), S(def.color, 0.6))
      frame.position.set(0, fh / 2 - cY, 0)
      frame.rotation.x = -0.14
      g.add(this.edged(frame))
      const photo = new THREE.Mesh(new THREE.PlaneGeometry(fw * 0.8, fh * 0.8), new THREE.MeshStandardMaterial({ color: 0x88a8c0, roughness: 0.6 }))
      photo.position.set(0, fh / 2 - cY + 0.001, ft / 2 + 0.001)
      photo.rotation.x = -0.14
      g.add(photo)
      const stand = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.3, fh * 0.75, 0.008), S(def.color, 0.6))
      stand.position.set(0, fh * 0.36 - cY, -0.035)
      stand.rotation.x = 0.5
      g.add(stand)
    } else if (def.id === "keybd") {
      const base = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, def.d), S(def.color, 0.6))
      base.position.y = def.h / 2 - cY
      base.rotation.x = -0.05
      g.add(this.edged(base))
      const rows = 4
      const keyH = 0.006
      for (let r = 0; r < rows; r++) {
        const rw = def.w * (r === rows - 1 ? 0.55 : 0.94)
        const row = new THREE.Mesh(new THREE.BoxGeometry(rw, keyH, def.d * 0.16), S(0x3a424c, 0.5))
        const z = -def.d * 0.36 + r * def.d * 0.24
        row.position.set(r === rows - 1 ? -def.w * 0.05 : 0, def.h + keyH / 2 - cY - z * 0.05, z)
        row.rotation.x = -0.05
        g.add(row)
        if (r < rows - 1)
          for (let k = 1; k < 10; k++) {
            const gp = new THREE.Mesh(new THREE.BoxGeometry(0.002, keyH * 1.05, def.d * 0.16), S(0x22272e, 0.6))
            gp.position.set(-rw / 2 + (rw * k) / 10, def.h + keyH / 2 - cY - z * 0.05, z)
            gp.rotation.x = -0.05
            g.add(gp)
          }
      }
    } else if (def.id === "mug") {
      const R = def.w / 2
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, def.h, 16, 1, true), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, side: THREE.DoubleSide }))
      cup.position.y = def.h / 2 - cY
      cup.castShadow = true
      g.add(cup)
      const bot = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.92, R * 0.92, 0.006, 16), S(def.color, 0.5))
      bot.position.y = 0.003 - cY
      g.add(bot)
      const cof = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.9, 0.004, 16), S(0x3a2a1c, 0.7))
      cof.position.y = def.h * 0.82 - cY
      g.add(cof)
      const hdl = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.007, 8, 14, Math.PI * 1.4), S(def.color, 0.5))
      hdl.position.set(R + 0.012, def.h * 0.52 - cY, 0)
      hdl.rotation.z = Math.PI / 2 + 0.9
      g.add(hdl)
    } else if (def.id === "phone") {
      const bodyM = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h * 0.7, def.d), S(def.color, 0.55))
      bodyM.position.y = def.h * 0.35 - cY
      bodyM.rotation.x = -0.18
      g.add(this.edged(bodyM))
      const hs = new THREE.Group()
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.022, def.d * 0.9), S(0x22262c, 0.5))
      hs.add(hb)
      for (const sz of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.05), S(0x22262c, 0.5))
        ear.position.set(0, -0.006, sz * def.d * 0.38)
        hs.add(ear)
      }
      hs.position.set(-def.w * 0.28, def.h * 0.72 - cY, 0)
      hs.rotation.x = -0.18
      g.add(hs)
      for (let r = 0; r < 3; r++)
        for (let c2 = 0; c2 < 3; c2++) {
          const btn = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.005, 0.014), S(0xb8bec6, 0.5))
          btn.position.set(def.w * 0.16 + (c2 - 1) * 0.024, def.h * 0.56 - cY + (1 - r) * 0.006, (r - 1) * 0.03)
          btn.rotation.x = -0.18
          g.add(btn)
        }
    } else if (def.id === "docs") {
      const nly = 5
      let rng = 7
      for (let i = 0; i < nly; i++) {
        rng = (rng * 48271) % 2147483647
        const ox = ((rng % 100) / 100 - 0.5) * 0.02
        rng = (rng * 48271) % 2147483647
        const oz = ((rng % 100) / 100 - 0.5) * 0.02
        const rot = ((rng % 100) / 100 - 0.5) * 0.12
        const sh = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.96, (def.h / nly) * 0.9, def.d * 0.96), S(i % 2 ? 0xf0f2f4 : 0xe6e9ee, 0.95))
        sh.position.set(ox, (def.h * (i + 0.5)) / nly - cY, oz)
        sh.rotation.y = rot
        g.add(sh)
      }
      const clip = new THREE.Mesh(new THREE.BoxGeometry(0.05, def.h * 0.5, 0.012), S(0x2a2f36, 0.4))
      clip.position.set(0, def.h * 0.75 - cY, def.d / 2 - 0.006)
      g.add(clip)
    } else if (def.id === "bookshelf") {
      const t = 0.022
      const iw = def.w - 2 * t
      const back = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, 0.012), S(0x6d4426))
      back.position.set(0, def.h / 2 - cY, -def.d / 2 + 0.006)
      g.add(back)
      for (const s of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(t, def.h, def.d), S(def.color))
        side.position.set(s * (def.w / 2 - t / 2), def.h / 2 - cY, 0)
        side.castShadow = true
        g.add(this.edged(side))
      }
      const nsh = 5
      const bookCols = [0x8a3b2e, 0x3b5a7a, 0x6b7a3b, 0x7a5a8a, 0x9c7b3a, 0x40606a, 0x8a6a4a]
      let rng = 2
      for (let i = 0; i <= nsh; i++) {
        const y = t / 2 + ((def.h - t) * i) / nsh - cY
        const sh = new THREE.Mesh(new THREE.BoxGeometry(def.w, t, def.d), S(def.color))
        sh.position.y = y
        sh.castShadow = true
        g.add(this.edged(sh))
        if (i < nsh) {
          const cellH = (def.h - t) / nsh - t
          let x = -iw / 2 + 0.015
          while (x < iw / 2 - 0.05) {
            rng = (rng * 48271) % 2147483647
            const bw = 0.028 + ((rng % 1000) / 1000) * 0.03
            rng = (rng * 48271) % 2147483647
            const bh = cellH * (0.55 + ((rng % 1000) / 1000) * 0.35)
            rng = (rng * 48271) % 2147483647
            const bk = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, def.d * 0.72), S(bookCols[rng % bookCols.length], 0.85))
            bk.position.set(x + bw / 2, y + t / 2 + bh / 2, -def.d * 0.06)
            g.add(bk)
            x += bw + 0.006
          }
        }
      }
    } else if (def.id === "chest") {
      const main = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, def.d), S(def.color))
      main.position.y = def.h / 2 - cY
      g.add(this.edged(main))
      const rows = 3
      const fh = def.h / rows - 0.02
      for (let i = 0; i < rows; i++) {
        const fy = (def.h * (i + 0.5)) / rows - cY
        const fc = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.94, fh, 0.014), S(0xb98f63, 0.8))
        fc.position.set(0, fy, def.d / 2 + 0.007)
        g.add(this.edged(fc))
        for (const s of [-1, 1]) {
          const kn = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 10), S(0x4a3a2a, 0.5))
          kn.rotation.x = Math.PI / 2
          kn.position.set(s * def.w * 0.22, fy, def.d / 2 + 0.024)
          g.add(kn)
        }
      }
      const topb = new THREE.Mesh(new THREE.BoxGeometry(def.w * 1.04, 0.02, def.d * 1.04), S(0x7a5a3a))
      topb.position.y = def.h + 0.01 - cY
      g.add(topb)
    } else {
      const main = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, def.d), S(def.color))
      main.position.y = def.h / 2 - cY
      g.add(this.edged(main))
    }
    if (def.id === "fridge") {
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.03), S(0x808a94))
      hd.position.set(def.w / 2 + 0.02, def.h * 0.65 - cY, def.d / 4)
      g.add(hd)
    }
    if (def.id === "cbox") {
      const tape = new THREE.Mesh(new THREE.BoxGeometry(0.07, def.h * 1.004, def.d * 1.004), S(0x8a6a3a, 0.9))
      tape.position.y = def.h / 2 - cY
      g.add(tape)
      const tape2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.004, def.d * 1.006), S(0x8a6a3a, 0.9))
      tape2.position.y = def.h - cY + 0.001
      g.add(tape2)
    }
    if (def.id === "minipc") {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.004), new THREE.MeshStandardMaterial({ color: 0x66ffcc, emissive: 0x33dd99, emissiveIntensity: 1.2 }))
      led.position.set(0, def.h * 0.85 - cY, def.d / 2 + 0.002)
      g.add(led)
    }
    return this.finishFurn(def, body, g)
  }

  private makeDesk(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const topT = 0.04
    const legW = 0.05
    const legH = def.h - topT
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, topT / 2, def.d / 2)), new CANNON.Vec3(0, def.h - topT / 2 - cY, 0))
    const lx = def.w / 2 - legW * 1.2
    const lz = def.d / 2 - legW * 1.2
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.addShape(new CANNON.Box(new CANNON.Vec3(legW / 2, legH / 2, legW / 2)), new CANNON.Vec3(sx * lx, legH / 2 - cY, sz * lz))
    const g = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(def.w, topT, def.d), this.stdMat(def.color, 0.6))
    top.position.y = def.h - topT / 2 - cY
    g.add(this.edged(top))
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), this.stdMat(0x6b5a42, 0.7))
        leg.position.set(sx * lx, legH / 2 - cY, sz * lz)
        leg.castShadow = true
        g.add(leg)
      }
    const drawer = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.35, 0.12, def.d * 0.9), this.stdMat(0x82725a))
    drawer.position.set(def.w * 0.28, def.h - topT - 0.07 - cY, 0)
    g.add(drawer)
    return this.finishFurn(def, body, g)
  }

  private makeChair(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const seatT = 0.05
    const legW = 0.04
    const legH = def.seatH - seatT
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, seatT / 2, def.d / 2)), new CANNON.Vec3(0, def.seatH - seatT / 2 - cY, 0))
    const lx = def.w / 2 - legW
    const lz = def.d / 2 - legW
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.addShape(new CANNON.Box(new CANNON.Vec3(legW / 2, legH / 2, legW / 2)), new CANNON.Vec3(sx * lx, legH / 2 - cY, sz * lz))
    const backH = def.h - def.seatH
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, backH / 2, 0.02)), new CANNON.Vec3(0, def.seatH + backH / 2 - cY, def.d / 2 - 0.02))
    const g = new THREE.Group()
    const seat = new THREE.Mesh(new THREE.BoxGeometry(def.w, seatT, def.d), this.stdMat(def.color, 0.7))
    seat.position.y = def.seatH - seatT / 2 - cY
    g.add(this.edged(seat))
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), this.stdMat(0x3d4a58, 0.7))
        leg.position.set(sx * lx, legH / 2 - cY, sz * lz)
        leg.castShadow = true
        g.add(leg)
      }
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, backH, 0.04), this.stdMat(0x3d4a58, 0.7))
      post.position.set(sx * (def.w / 2 - 0.03), def.seatH + backH / 2 - cY, def.d / 2 - 0.02)
      g.add(post)
    }
    const slat = new THREE.Mesh(new THREE.BoxGeometry(def.w, 0.12, 0.03), this.stdMat(def.color, 0.7))
    slat.position.set(0, def.h - 0.1 - cY, def.d / 2 - 0.02)
    g.add(this.edged(slat))
    return this.finishFurn(def, body, g)
  }

  private makeBed(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, def.h / 2, def.d / 2)), new CANNON.Vec3(0, def.h / 2 - cY, 0))
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.03, (def.headH - def.h) / 2, def.d / 2)), new CANNON.Vec3(def.w / 2 - 0.03, (def.h + def.headH) / 2 - cY, 0))
    const g = new THREE.Group()
    const frame = new THREE.Mesh(new THREE.BoxGeometry(def.w, 0.22, def.d), this.stdMat(def.color, 0.7))
    frame.position.y = 0.11 - cY
    g.add(this.edged(frame))
    const mat = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.98, 0.2, def.d * 0.96), this.stdMat(0xe8e4da, 0.9))
    mat.position.y = 0.22 + 0.1 - cY
    g.add(this.edged(mat))
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.62, 0.05, def.d * 0.98), this.stdMat(0x7d9db8, 0.95))
    blanket.position.set(-def.w * 0.18, 0.42 - cY + 0.005, 0)
    g.add(blanket)
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.45), this.stdMat(0xf4f1ea, 0.95))
    pillow.position.set(def.w / 2 - 0.28, 0.46 - cY, 0)
    g.add(pillow)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, def.headH, def.d), this.stdMat(0x5b4128, 0.7))
    head.position.set(def.w / 2 - 0.03, def.headH / 2 - cY, 0)
    g.add(this.edged(head))
    return this.finishFurn(def, body, g)
  }

  private mkCord(body: CANNON.Body, pivotLocal: CANNON.Vec3, anchorLocal: CANNON.Vec3, drawLocal?: CANNON.Vec3) {
    const c = new CANNON.PointToPointConstraint(body, pivotLocal, this.roomBody, anchorLocal)
    this.world.addConstraint(c)
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x9aa4b2 }))
    this.scene.add(line)
    return { constraint: c, pivotLocal, anchorLocal, drawLocal: drawLocal || pivotLocal, line }
  }
  private makeLamp(def: any) {
    const body = new CANNON.Body({ mass: this.furnCfg(def).mass })
    body.addShape(new CANNON.Sphere(0.1))
    body.position.set(def.pos[0] + this.roomOffset.px, this.ROOM_H - def.cord + this.roomOffset.py, def.pos[1] + this.roomOffset.pz)
    body.velocity.set(this.roomOffset.vx, this.roomOffset.vy, this.roomOffset.vz)
    body.linearDamping = 0.02
    body.allowSleep = false
    this.world.addBody(body)
    const cords = [this.mkCord(body, new CANNON.Vec3(0, def.cord, 0), new CANNON.Vec3(def.pos[0], this.ROOM_H, def.pos[1]))]
    const g = new THREE.Group()
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.16, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x35404d, side: THREE.DoubleSide }))
    shade.position.y = 0.06
    g.add(shade)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), new THREE.MeshStandardMaterial({ color: def.color, emissive: 0xf5d67a, emissiveIntensity: 0.9 }))
    g.add(bulb)
    const pt = new THREE.PointLight(0xffe6b0, 0.6, 5)
    g.add(pt)
    this.scene.add(g)
    return { def, body, mesh: g, cords, restX: def.pos[0], restZ: def.pos[1], cordLen: def.cord, startPos: body.position.clone(), fallen: false, slid: false }
  }
  private makeLampBar(def: any) {
    const cfg = this.furnCfg(def)
    const L = def.len
    const hw = L / 2
    const body = new CANNON.Body({ mass: cfg.mass })
    body.addShape(new CANNON.Box(new CANNON.Vec3(hw, 0.028, 0.07)))
    body.position.set(def.pos[0] + this.roomOffset.px, this.ROOM_H - def.cord - 0.028 + this.roomOffset.py, def.pos[1] + this.roomOffset.pz)
    body.velocity.set(this.roomOffset.vx, this.roomOffset.vy, this.roomOffset.vz)
    body.linearDamping = 0.03
    body.angularDamping = 0.05
    body.allowSleep = false
    this.world.addBody(body)
    const cords: any[] = []
    for (const s of [-1, 1])
      cords.push(this.mkCord(body, new CANNON.Vec3(s * hw * 0.9, def.cord + 0.028, 0), new CANNON.Vec3(def.pos[0] + s * hw * 0.9, this.ROOM_H, def.pos[1]), new CANNON.Vec3(s * hw * 0.9, 0.028, 0)))
    const g = new THREE.Group()
    const housing = new THREE.Mesh(new THREE.BoxGeometry(L, 0.055, 0.14), this.stdMat(0xd6dae0, 0.5))
    housing.castShadow = true
    g.add(housing)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(L * 0.96, 0.012, 0.1), new THREE.MeshStandardMaterial({ color: def.color, emissive: 0xf0f4fa, emissiveIntensity: 1.1 }))
    panel.position.y = -0.03
    g.add(panel)
    const pt = new THREE.PointLight(0xf2f6ff, 0.35, 4.5)
    pt.position.y = -0.2
    g.add(pt)
    this.scene.add(g)
    return { def, body, mesh: g, cords, restX: def.pos[0], restZ: def.pos[1], cordLen: def.cord, startPos: body.position.clone(), fallen: false, slid: false }
  }

  private makePDesk(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const topT = 0.03
    const pedW = 0.42
    const pedH = def.h - topT
    const legT = 0.035
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, topT / 2, def.d / 2)), new CANNON.Vec3(0, def.h - topT / 2 - cY, 0))
    const g = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(def.w, topT, def.d), this.stdMat(def.color, 0.5))
    top.position.y = def.h - topT / 2 - cY
    g.add(this.edged(top))
    const sides = [
      { x: def.w / 2 - pedW / 2 - 0.01, ped: def.ped >= 1 },
      { x: -def.w / 2 + pedW / 2 + 0.01, ped: def.ped >= 2 },
    ]
    for (const s of sides) {
      if (s.ped) {
        body.addShape(new CANNON.Box(new CANNON.Vec3(pedW / 2, pedH / 2, (def.d / 2) * 0.94)), new CANNON.Vec3(s.x, pedH / 2 - cY, 0))
        const ped = new THREE.Mesh(new THREE.BoxGeometry(pedW, pedH, def.d * 0.94), this.stdMat(0xb9bfc7, 0.6))
        ped.position.set(s.x, pedH / 2 - cY, 0)
        g.add(this.edged(ped))
        for (let i = 0; i < 3; i++) {
          const fh = pedH / 3 - 0.015
          const face = new THREE.Mesh(new THREE.BoxGeometry(pedW * 0.92, fh, 0.012), this.stdMat(0xcbd1d8, 0.55))
          face.position.set(s.x, (pedH * (i + 0.5)) / 3 - cY, def.d * 0.47 + 0.006)
          g.add(face)
          const hdl = new THREE.Mesh(new THREE.BoxGeometry(pedW * 0.5, 0.015, 0.015), this.stdMat(0x5a636e, 0.4))
          hdl.position.set(s.x, (pedH * (i + 1)) / 3 - 0.04 - cY, def.d * 0.47 + 0.016)
          g.add(hdl)
        }
      } else {
        const lx = Math.sign(s.x) * (def.w / 2 - legT / 2 - 0.02)
        body.addShape(new CANNON.Box(new CANNON.Vec3(legT / 2, pedH / 2, (def.d / 2) * 0.86)), new CANNON.Vec3(lx, pedH / 2 - cY, 0))
        const leg = new THREE.Mesh(new THREE.BoxGeometry(legT, pedH, def.d * 0.86), this.stdMat(0x9aa1a9, 0.6))
        leg.position.set(lx, pedH / 2 - cY, 0)
        leg.castShadow = true
        g.add(leg)
      }
    }
    const mod = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.8, pedH * 0.45, 0.015), this.stdMat(0xaab0b8, 0.7))
    mod.position.set(0, def.h - topT - (pedH * 0.45) / 2 - 0.02 - cY, -def.d * 0.44)
    g.add(mod)
    return this.finishFurn(def, body, g)
  }

  private makeOfficeChair(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const baseR = 0.29
    const baseT = 0.05
    const colR = 0.028
    const seatT = 0.07
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(baseR * 0.82, baseT / 2, baseR * 0.82)), new CANNON.Vec3(0, baseT / 2 - cY, 0))
    body.addShape(new CANNON.Box(new CANNON.Vec3(colR, (def.seatH - baseT - seatT) / 2, colR)), new CANNON.Vec3(0, (def.seatH - seatT + baseT) / 2 - cY, 0))
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, seatT / 2, def.d / 2)), new CANNON.Vec3(0, def.seatH - seatT / 2 - cY, 0))
    const backH = def.h - def.seatH
    body.addShape(new CANNON.Box(new CANNON.Vec3((def.w / 2) * 0.92, backH / 2, 0.03)), new CANNON.Vec3(0, def.seatH + backH / 2 - cY, def.d / 2 - 0.03))
    const g = new THREE.Group()
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      const arm = new THREE.Mesh(new THREE.BoxGeometry(baseR, 0.035, 0.05), this.stdMat(0x3a424c, 0.5))
      arm.position.set((Math.cos(a) * baseR) / 2, baseT - 0.01 - cY, (Math.sin(a) * baseR) / 2)
      arm.rotation.y = -a
      arm.castShadow = true
      g.add(arm)
      const cas = new THREE.Mesh(new THREE.SphereGeometry(0.033, 10, 8), this.stdMat(0x22282f, 0.4))
      cas.position.set(Math.cos(a) * baseR * 0.92, 0.033 - cY, Math.sin(a) * baseR * 0.92)
      g.add(cas)
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(colR, colR * 1.3, def.seatH - baseT - seatT, 12), this.stdMat(0x555e69, 0.4))
    col.position.y = (def.seatH - seatT + baseT) / 2 - cY
    g.add(col)
    const seat = new THREE.Mesh(new THREE.BoxGeometry(def.w, seatT, def.d), this.stdMat(def.color, 0.85))
    seat.position.y = def.seatH - seatT / 2 - cY
    g.add(this.edged(seat))
    const back = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.92, backH, 0.06), this.stdMat(def.color, 0.85))
    back.position.set(0, def.seatH + backH / 2 - cY, def.d / 2 - 0.03)
    g.add(this.edged(back))
    return this.finishFurn(def, body, g)
  }

  private makeMonitor(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const baseW = 0.24
    const baseD = 0.16
    const baseT = 0.02
    const panT = 0.035
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(baseW / 2, baseT / 2, baseD / 2)), new CANNON.Vec3(0, baseT / 2 - cY, 0))
    const panH = def.h - 0.09
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, panH / 2, panT / 2)), new CANNON.Vec3(0, 0.09 + panH / 2 - cY, -0.03))
    const g = new THREE.Group()
    const base = new THREE.Mesh(new THREE.BoxGeometry(baseW, baseT, baseD), this.stdMat(0x1c2127, 0.5))
    base.position.y = baseT / 2 - cY
    g.add(this.edged(base))
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.03), this.stdMat(0x1c2127, 0.5))
    st.position.set(0, baseT + 0.035 - cY, -0.03)
    g.add(st)
    const pan = new THREE.Mesh(new THREE.BoxGeometry(def.w, panH, panT), this.stdMat(def.color, 0.4))
    pan.position.set(0, 0.09 + panH / 2 - cY, -0.03)
    g.add(this.edged(pan))
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(def.w * 0.93, panH * 0.88), new THREE.MeshStandardMaterial({ color: 0x2e4a6b, emissive: 0x1d3a5c, emissiveIntensity: 0.5, roughness: 0.3 }))
    scr.position.set(0, 0.09 + panH / 2 - cY, -0.03 + panT / 2 + 0.001)
    g.add(scr)
    return this.finishFurn(def, body, g)
  }

  private makeCabinet(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, def.h / 2, def.d / 2)), new CANNON.Vec3(0, def.h / 2 - cY, 0))
    const g = new THREE.Group()
    const main = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, def.d), this.stdMat(def.color, 0.45))
    main.position.y = def.h / 2 - cY
    g.add(this.edged(main))
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.008, def.h * 0.94, 0.006), this.stdMat(0x8a9099, 0.5))
    seam.position.set(0, def.h / 2 - cY, def.d / 2 + 0.003)
    g.add(seam)
    for (const s of [-1, 1]) {
      const hdl = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.11, 0.02), this.stdMat(0x525a64, 0.4))
      hdl.position.set(s * 0.05, def.h * 0.55 - cY, def.d / 2 + 0.012)
      g.add(hdl)
    }
    return this.finishFurn(def, body, g)
  }

  private makePartition(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const panT = 0.04
    const footH = 0.035
    const footL = def.d
    const footW = 0.06
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, (def.h - footH) / 2, panT / 2)), new CANNON.Vec3(0, footH + (def.h - footH) / 2 - cY, 0))
    for (const s of [-1, 1]) body.addShape(new CANNON.Box(new CANNON.Vec3(footW / 2, footH / 2, footL / 2)), new CANNON.Vec3(s * (def.w / 2 - footW / 2), footH / 2 - cY, 0))
    const g = new THREE.Group()
    const pan = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h - footH, panT), this.stdMat(def.color, 0.9))
    pan.position.y = footH + (def.h - footH) / 2 - cY
    g.add(this.edged(pan))
    const fr = new THREE.Mesh(new THREE.BoxGeometry(def.w * 1.01, 0.04, panT * 1.2), this.stdMat(0x59636e, 0.5))
    fr.position.y = def.h - 0.02 - cY
    g.add(fr)
    for (const s of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(footW, footH, footL), this.stdMat(0x59636e, 0.5))
      foot.position.set(s * (def.w / 2 - footW / 2), footH / 2 - cY, 0)
      foot.castShadow = true
      g.add(foot)
    }
    return this.finishFurn(def, body, g)
  }

  private makeCopier(def: any) {
    const { mass, cogY } = this.furnCfg(def)
    const cY = cogY
    const casR = 0.045
    const bodyH = def.h - casR * 2
    const body = this.newBody(def, cY, mass)
    body.addShape(new CANNON.Box(new CANNON.Vec3(def.w / 2, bodyH / 2, def.d / 2)), new CANNON.Vec3(0, casR * 2 + bodyH / 2 - cY, 0))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.addShape(new CANNON.Sphere(casR), new CANNON.Vec3(sx * (def.w / 2 - casR * 1.3), casR - cY, sz * (def.d / 2 - casR * 1.3)))
    const g = new THREE.Group()
    const main = new THREE.Mesh(new THREE.BoxGeometry(def.w, bodyH, def.d), this.stdMat(def.color, 0.5))
    main.position.y = casR * 2 + bodyH / 2 - cY
    g.add(this.edged(main))
    const dark = new THREE.Mesh(new THREE.BoxGeometry(def.w * 1.005, bodyH * 0.22, def.d * 1.005), this.stdMat(0x3a424c, 0.55))
    dark.position.y = casR * 2 + bodyH * 0.45 - cY
    g.add(dark)
    const cp = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.6, 0.02, 0.22), this.stdMat(0x2a3138, 0.4))
    cp.position.set(0, def.h - cY + 0.01, def.d / 2 - 0.08)
    cp.rotation.x = -0.25
    g.add(cp)
    const tray = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.8, 0.015, 0.28), this.stdMat(0xcfd4da, 0.6))
    tray.position.set(0, casR * 2 + bodyH * 0.62 - cY, -def.d / 2 - 0.1)
    g.add(tray)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const cas = new THREE.Mesh(new THREE.SphereGeometry(casR, 10, 8), this.stdMat(0x22282f, 0.4))
        cas.position.set(sx * (def.w / 2 - casR * 1.3), casR - cY, sz * (def.d / 2 - casR * 1.3))
        g.add(cas)
      }
    return this.finishFurn(def, body, g)
  }

  private builder(kind: string) {
    const map: Record<string, (d: any) => any> = {
      box: (d) => this.makeBoxFurn(d),
      desk: (d) => this.makeDesk(d),
      chair: (d) => this.makeChair(d),
      bed: (d) => this.makeBed(d),
      lamp: (d) => this.makeLamp(d),
      lampbar: (d) => this.makeLampBar(d),
      pdesk: (d) => this.makePDesk(d),
      ochair: (d) => this.makeOfficeChair(d),
      monitor: (d) => this.makeMonitor(d),
      cabinet: (d) => this.makeCabinet(d),
      partition: (d) => this.makePartition(d),
      copier: (d) => this.makeCopier(d),
    }
    return map[kind]
  }

  /* --------------------------------------------------- 配置 / 清除家具 */
  private clearFurniture() {
    for (const f of this.furniture) {
      this.world.removeBody(f.body)
      if (f.cords) for (const c of f.cords) { this.world.removeConstraint(c.constraint); this.scene.remove(c.line) }
      this.scene.remove(f.mesh)
    }
    this.furniture = []
  }
  private startT() {
    if (!this.proc) return 0
    return Math.min(Math.max(this.startSkip, 0), Math.max(this.proc.dur - 1, 0))
  }
  placeFurniture() {
    this.stopSimCore()
    this.clearFurniture()
    if (this.proc) this.tablePose(this.startT(), this.roomOffset)
    else this.roomOffset = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 }
    this.roomBody.position.set(this.roomOffset.px, this.roomOffset.py, this.roomOffset.pz)
    this.roomBody.velocity.set(0, 0, 0)
    this.roomGroup.position.set(this.roomOffset.px, this.roomOffset.py, this.roomOffset.pz)
    for (const def of SCENES[this.sceneKey].furn) {
      const st = this.furn[def.id]
      if (!st || !st.on) continue
      const units = def.units || [{ pos: def.pos, face: def.face || 0, y0: def.y0 || 0 }]
      units.forEach((u: any, i: number) => {
        const d = Object.assign({}, def, { pos: u.pos, face: u.face || 0, y0: u.y0 || 0, name: def.name + (units.length > 1 ? ` #${i + 1}` : "") })
        this.furniture.push(this.builder(def.kind)(d))
      })
    }
    this.updateStatus()
  }

  /* ---------------------------------------------------------- 模擬迴圈 */
  private sampleWave(arr: Float64Array, t: number) {
    const i = t / this.proc.dt
    const i0 = Math.floor(i)
    if (i0 >= this.proc.n - 1) return arr[this.proc.n - 1] * 0.01
    const f = i - i0
    return (arr[i0] * (1 - f) + arr[i0 + 1] * f) * 0.01
  }
  private axIdx() {
    return this.swap ? { ns: 1, ew: 0 } : { ns: 0, ew: 1 }
  }
  private tablePose(t: number, out: any) {
    const s = this.ampScale || 1
    const { ns, ew } = this.axIdx()
    out.px = this.sampleWave(this.proc.dsp[ew], t) * s
    out.pz = -this.sampleWave(this.proc.dsp[ns], t) * s
    out.py = this.sampleWave(this.proc.dsp[2], t) * s
    out.vx = this.sampleWave(this.proc.vel[ew], t) * s
    out.vz = -this.sampleWave(this.proc.vel[ns], t) * s
    out.vy = this.sampleWave(this.proc.vel[2], t) * s
    out.ax = this.sampleWave(this.proc.acc[ew], t) * s
    out.az = -this.sampleWave(this.proc.acc[ns], t) * s
    out.ay = this.sampleWave(this.proc.acc[2], t) * s
  }
  private loop(ts: number) {
    if (this._disposed) return
    this._raf = requestAnimationFrame((t) => this.loop(t))
    const dtReal = Math.min((ts - this._lastFrame) / 1000, 0.05)
    this._lastFrame = ts
    if (this.running && this.proc) {
      const speed = this.speed
      this.simT = Math.min(this.simT + dtReal * speed, this.proc.dur)
      while (this.physT < this.simT) {
        this.physT += PHYS_DT
        this.tablePose(this.physT, this._pose)
        this.roomBody.position.set(this._pose.px, this._pose.py, this._pose.pz)
        this.roomBody.velocity.set(this._pose.vx, this._pose.vy, this._pose.vz)
        this.world.step(PHYS_DT)
        this.applyStiction()
      }
      this.roomGroup.position.set(this._pose.px, this._pose.py, this._pose.pz)
      if (this.liveRefs.timeEl) this.liveRefs.timeEl.textContent = this.simT.toFixed(1) + " s"
      if (this.simT >= this.proc.dur) {
        this.running = false
        this.flash("加振結束")
      }
      this.updateStatus()
      this.drawCursor()
      this.updateAccHud()
      this.drawOrbit()
    }
    const _pv = new CANNON.Vec3()
    for (const f of this.furniture) {
      f.mesh.position.copy(f.body.position)
      f.mesh.quaternion.copy(f.body.quaternion)
      if (f.cords)
        for (const c of f.cords) {
          f.body.quaternion.vmult(c.drawLocal, _pv)
          const pts = c.line.geometry.attributes.position.array
          pts[0] = c.anchorLocal.x + this.roomBody.position.x
          pts[1] = c.anchorLocal.y + this.roomBody.position.y
          pts[2] = c.anchorLocal.z + this.roomBody.position.z
          pts[3] = f.body.position.x + _pv.x
          pts[4] = f.body.position.y + _pv.y
          pts[5] = f.body.position.z + _pv.z
          c.line.geometry.attributes.position.needsUpdate = true
        }
    }
    this.renderer.render(this.scene, this.camera)
  }

  private applyStiction() {
    if (!this.furniture.length) return
    const inContact = new Set<CANNON.Body>()
    for (const c of this.world.contacts) {
      if (c.bi === this.roomBody) inContact.add(c.bj)
      else if (c.bj === this.roomBody) inContact.add(c.bi)
    }
    const geff = Math.max(9.81 + this._pose.ay, 0)
    for (const f of this.furniture) {
      if (f.def.lamp) continue
      if (inContact.has(f.body)) f._cg = CONTACT_GRACE
      else if (f._cg > 0) f._cg--
      const vyRel = Math.abs(f.body.velocity.y - this._pose.vy)
      if (!(f._cg > 0) || vyRel > VY_AIRBORNE) {
        f.stuck = false
        continue
      }
      const m = f.body.mass
      const N = m * geff
      const Jmax = f.def.mu * MUS_OVER_MUK * N * PHYS_DT
      const dvx = f.body.velocity.x - this._pose.vx
      const dvz = f.body.velocity.z - this._pose.vz
      const Jneed = m * Math.hypot(dvx, dvz)
      if (Jneed <= Jmax) {
        f.body.velocity.x = this._pose.vx
        f.body.velocity.z = this._pose.vz
        f.stuck = true
        const wy = f.body.angularVelocity.y
        if (wy !== 0) {
          const reff = 0.3 * Math.min(f.def.w || 0.4, f.def.d || 0.4)
          const Iy = Math.max(f.body.inertia.y, 1e-6)
          const Lmax = f.def.mu * MUS_OVER_MUK * N * reff * PHYS_DT
          const Lneed = Math.abs(Iy * wy)
          if (Lneed <= Lmax) f.body.angularVelocity.y = 0
          else f.body.angularVelocity.y -= (Math.sign(wy) * Lmax) / Iy
        }
      } else {
        f.stuck = false
      }
    }
  }

  private updateStatus() {
    const el = this.liveRefs.statusEl
    if (!el) return
    if (!this.furniture.length) {
      el.innerHTML = '<span class="text-muted-foreground">— 未配置 —</span>'
      return
    }
    const up = new CANNON.Vec3(0, 1, 0)
    const tmp = new CANNON.Vec3()
    let html = ""
    for (const f of this.furniture) {
      if (f.def.lamp) {
        const dx = f.body.position.x - (f.restX + this.roomBody.position.x)
        const dz = f.body.position.z - (f.restZ + this.roomBody.position.z)
        const ang = (Math.atan2(Math.hypot(dx, dz), f.cordLen) * 180) / Math.PI
        html += `<div class="flex justify-between"><span>${f.def.name}</span><span class="font-mono ${ang > 20 ? "text-dsp" : "text-muted-foreground"}">擺動 ${ang.toFixed(0)}°</span></div>`
        continue
      }
      f.body.quaternion.vmult(up, tmp)
      const tilt = (Math.acos(Math.max(-1, Math.min(1, tmp.y))) * 180) / Math.PI
      if (tilt > 45) f.fallen = true
      const relx = f.body.position.x - this.roomBody.position.x - f.startPos.x
      const relz = f.body.position.z - this.roomBody.position.z - f.startPos.z
      const slide = Math.hypot(relx, relz) * 100
      if (slide > 5) f.slid = true
      let st: string
      let cls: string
      if (f.fallen) { st = "轉倒"; cls = "text-acc" }
      else if (f.slid) { st = `移動 ${slide.toFixed(0)}cm`; cls = "text-dsp" }
      else { st = `傾斜 ${tilt.toFixed(0)}°`; cls = "text-muted-foreground" }
      html += `<div class="flex justify-between"><span>${f.def.name}</span><span class="font-mono ${cls}">${st}</span></div>`
    }
    el.innerHTML = html
  }

  /* ------------------------------------------------------------ 波形圖 */
  setChartCanvases(list: HTMLCanvasElement[] | null) {
    this.chartCanvases = list
    // 首次以 willReadFrequently 建立 2D context（波形快取會頻繁 getImageData）
    if (list) for (const c of list) c.getContext("2d", { willReadFrequently: true })
    if (list && this.proc) {
      this.sizeCharts()
      this.staticCache = null
      this.drawChartsBase()
    }
  }
  setOrbitCanvas(el: HTMLCanvasElement | null) {
    this.orbitCanvas = el
    if (el) el.getContext("2d", { willReadFrequently: true })
    if (el && this.proc) {
      this.orbitCache = null
      this.drawOrbit()
    }
  }
  setLiveRefs(refs: Partial<LiveRefs>) {
    this.liveRefs = { ...this.liveRefs, ...refs }
    if (this.liveRefs.timeEl) this.liveRefs.timeEl.textContent = this.simT.toFixed(1) + " s"
    this.updateStatus()
    this.updateAccHud()
  }
  private sizeCharts() {
    if (!this.chartCanvases) return
    for (const c of this.chartCanvases) {
      const r = c.getBoundingClientRect()
      if (r.width > 0) {
        c.width = r.width * devicePixelRatio
        c.height = r.height * devicePixelRatio
      }
    }
  }
  private waveRange(): [number, number] {
    if (!this.proc) return [0, 1]
    if (this.waveView === "full") return [0, this.proc.dur]
    const half = 15
    let t0 = this.simT - half
    let t1 = this.simT + half
    if (t0 < 0) { t1 -= t0; t0 = 0 }
    if (t1 > this.proc.dur) { t0 = Math.max(0, t0 - (t1 - this.proc.dur)); t1 = this.proc.dur }
    return [t0, t1]
  }
  private drawCursor() {
    if (!this.proc || !this.chartCanvases) return
    if (this.waveView === "win") { this.drawChartsBase(); return }
    const frac = this.simT / this.proc.dur
    if (Math.abs(frac - this.cursorPrev) < 0.002) return
    this.cursorPrev = frac
    this.drawChartsBase()
  }
  private drawChartsBase() {
    if (!this.chartCanvases) return
    this.drawChartsStatic()
    const [t0, t1] = this.waveRange()
    const frac = (this.simT - t0) / Math.max(1e-9, t1 - t0)
    for (const c of this.chartCanvases) {
      const g = c.getContext("2d")!
      g.strokeStyle = "#ffffff"
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(frac * c.width, 0)
      g.lineTo(frac * c.width, c.height)
      g.stroke()
    }
  }
  private drawChartsStatic() {
    if (!this.chartCanvases) return
    if (this.waveView === "win") { this.drawChartsRaw(); return }
    if (!this.staticCache) { this.drawChartsRaw(); this.cacheStatic() }
    for (let i = 0; i < 3; i++) {
      const c = this.chartCanvases[i]
      if (this.staticCache) c.getContext("2d")!.putImageData(this.staticCache[i], 0, 0)
    }
  }
  private cacheStatic() {
    if (!this.chartCanvases) return
    this.staticCache = this.chartCanvases.map((c) => c.getContext("2d")!.getImageData(0, 0, c.width, c.height))
  }
  private drawChartsRaw() {
    if (!this.chartCanvases) return
    const sets = [this.proc.acc, this.proc.vel, this.proc.dsp]
    const [t0, t1] = this.waveRange()
    const j0 = Math.max(0, Math.floor(t0 / this.proc.dt))
    const j1 = Math.min(this.proc.n - 1, Math.ceil(t1 / this.proc.dt))
    const span = Math.max(1, j1 - j0)
    for (let s = 0; s < 3; s++) {
      const c = this.chartCanvases[s]
      const g = c.getContext("2d")!
      const W = c.width
      const H = c.height
      g.clearRect(0, 0, W, H)
      let mx = 0
      for (const arr of sets[s]) for (let i = 0; i < arr.length; i++) { const v = Math.abs(arr[i]); if (v > mx) mx = v }
      if (mx === 0) mx = 1
      g.strokeStyle = "#2a3442"
      g.beginPath()
      g.moveTo(0, H / 2)
      g.lineTo(W, H / 2)
      g.stroke()
      for (let comp = 0; comp < 3; comp++) {
        const arr = sets[s][comp]
        g.strokeStyle = compColors[comp]
        g.lineWidth = 1
        g.beginPath()
        for (let px = 0; px < W; px++) {
          const i0 = j0 + Math.floor((px / W) * span)
          const i1 = j0 + Math.floor(((px + 1) / W) * span)
          let lo = 1e9
          let hi = -1e9
          for (let i = i0; i < Math.max(i1, i0 + 1); i++) { const v = arr[i]; if (v < lo) lo = v; if (v > hi) hi = v }
          g.moveTo(px + 0.5, H / 2 - (lo / mx) * (H / 2) * 0.92)
          g.lineTo(px + 0.5, H / 2 - (hi / mx) * (H / 2) * 0.92)
        }
        g.stroke()
      }
      g.fillStyle = "#8593a5"
      g.font = `${10 * devicePixelRatio}px monospace`
      g.fillText("±" + mx.toFixed(1), 4 * devicePixelRatio, 12 * devicePixelRatio)
      if (this.waveView === "win") {
        g.fillText(t0.toFixed(0) + "s", 4 * devicePixelRatio, H - 4 * devicePixelRatio)
        const lbl = t1.toFixed(0) + "s"
        g.fillText(lbl, W - (lbl.length * 6 + 4) * devicePixelRatio, H - 4 * devicePixelRatio)
      }
    }
  }

  /* ------------------------------------------------------- 變位軌跡 */
  private niceStep(mx: number) {
    const e = Math.pow(10, Math.floor(Math.log10(mx)))
    for (const m of [1, 2, 5, 10]) if (m * e >= mx / 2.2) return m * e
    return e
  }
  private drawOrbitStatic() {
    const c = this.orbitCanvas
    if (!c) return
    const W = (c.width = c.clientWidth * devicePixelRatio || 230)
    const H = (c.height = c.clientHeight * devicePixelRatio || 230)
    const g = c.getContext("2d")!
    g.clearRect(0, 0, W, H)
    this.orbitCache = null
    if (!this.proc) return
    const s = this.ampScale || 1
    const { ns, ew } = this.axIdx()
    const X = this.proc.dsp[ew]
    const Y = this.proc.dsp[ns]
    let mx = 0
    for (let i = 0; i < this.proc.n; i++) { const v = Math.max(Math.abs(X[i]), Math.abs(Y[i])); if (v > mx) mx = v }
    const orbitMx = Math.max(mx * s, 1e-6)
    const cx = W / 2
    const cy = H / 2
    const R = (Math.min(W, H) / 2) * 0.88
    const sc = R / orbitMx
    const step = this.niceStep(orbitMx)
    g.strokeStyle = "#233040"
    g.fillStyle = "#5d6b7d"
    g.font = `${9 * devicePixelRatio}px monospace`
    for (let r = step; r <= orbitMx * 1.001; r += step) {
      g.beginPath()
      g.arc(cx, cy, r * sc, 0, Math.PI * 2)
      g.stroke()
      g.fillText(r.toFixed(step < 1 ? 1 : 0), cx + r * sc + 2, cy - 2)
    }
    g.beginPath()
    g.moveTo(cx - R, cy)
    g.lineTo(cx + R, cy)
    g.moveTo(cx, cy - R)
    g.lineTo(cx, cy + R)
    g.stroke()
    g.fillStyle = "#8593a5"
    g.fillText("N", cx - 3 * devicePixelRatio, cy - R - 3)
    g.fillText("E", cx + R + 3, cy + 3 * devicePixelRatio)
    g.fillText("cm", 4, H - 6)
    g.strokeStyle = "rgba(90,162,255,0.35)"
    g.lineWidth = 1
    g.beginPath()
    const dec = Math.max(1, Math.floor(this.proc.n / 6000))
    for (let i = 0; i < this.proc.n; i += dec) {
      const px = cx + X[i] * s * sc
      const py = cy - Y[i] * s * sc
      i === 0 ? g.moveTo(px, py) : g.lineTo(px, py)
    }
    g.stroke()
    this.orbitCache = g.getImageData(0, 0, W, H)
    ;(this.orbitCache as any)._geo = { cx, cy, sc }
  }
  private drawOrbit() {
    if (!this.orbitOpen || !this.orbitCanvas) return
    const c = this.orbitCanvas
    const g = c.getContext("2d")!
    if (!this.proc) { g.clearRect(0, 0, c.width, c.height); return }
    if (!this.orbitCache) this.drawOrbitStatic()
    if (!this.orbitCache) return
    g.putImageData(this.orbitCache, 0, 0)
    const { cx, cy, sc } = (this.orbitCache as any)._geo
    const s = this.ampScale || 1
    const { ns, ew } = this.axIdx()
    const X = this.proc.dsp[ew]
    const Y = this.proc.dsp[ns]
    const i1 = Math.min(Math.floor(this.simT / this.proc.dt), this.proc.n - 1)
    const i0 = Math.max(0, i1 - Math.round(2 / this.proc.dt))
    g.strokeStyle = "#f5b942"
    g.lineWidth = 1.6 * devicePixelRatio
    g.beginPath()
    for (let i = i0; i <= i1; i++) {
      const px = cx + X[i] * s * sc
      const py = cy - Y[i] * s * sc
      i === i0 ? g.moveTo(px, py) : g.lineTo(px, py)
    }
    g.stroke()
    g.fillStyle = "#ffffff"
    g.beginPath()
    g.arc(cx + X[i1] * s * sc, cy - Y[i1] * s * sc, 3 * devicePixelRatio, 0, Math.PI * 2)
    g.fill()
  }

  private updateAccHud() {
    const el = this.liveRefs.accEl
    if (!el) return
    if (!this.proc) { el.textContent = "—"; return }
    const s = this.ampScale || 1
    const i1 = Math.min(Math.floor(this.simT / this.proc.dt), this.proc.n - 1)
    const i0 = Math.max(0, i1 - Math.round(1 / this.proc.dt))
    let mx = 0
    for (let i = i0; i <= i1; i++) {
      const A = Math.hypot(this.proc.acc[0][i], this.proc.acc[1][i], this.proc.acc[2][i])
      if (A > mx) mx = A
    }
    el.textContent = (mx * s).toFixed(1)
  }

  /* ---------------------------------------------------------- 建物模式 */
  private refreshPeaks() {
    if (!this.proc) { this.peaks = null; return }
    const tag = this.proc.bld ? `（${this.proc.bld.floor}樓地板應答）` : "（地表）"
    this.peaks = { pga: this.proc.pga, pgv: this.proc.pgv, pgd: this.proc.pgd, tag }
  }
  private applyBuildingMode() {
    if (!this.procGround) return
    this.proc = this.bld.on ? buildingResponse(this.procGround, this.bld) : this.procGround
    this.staticCache = null
    this.orbitCache = null
    this.refreshPeaks()
    if (this.bld.on && this.proc.bld) {
      const B = this.proc.bld
      this.bldInfo =
        `${B.N}層 ${B.type}造 / T₁=${B.T1.toFixed(2)}s h=${(B.h * 100).toFixed(0)}%\n` +
        `對象：${B.floor}樓地板 / PA 放大 ×${(this.proc.pga / this.procGround.pga).toFixed(2)}\n` +
        `※水平兩分量應答解析，UD 用地表波`
    } else this.bldInfo = ""
    this.sizeCharts()
    this.placeFurniture()
  }

  /* ------------------------------------------------------------ 公開 API */
  loadMseed(buffer: ArrayBuffer, fileName: string) {
    let rec
    try {
      rec = parseMseed(buffer)
    } catch (err: any) {
      this.flash("讀取失敗：" + (err?.message || err))
      return
    }
    this.procGround = processRecord(rec)
    const intensity = computeJmaIntensity(rec.acc, rec.header.fs)
    this.recordInfo = {
      fileName,
      type: rec.header.type,
      station: rec.header.station,
      net: rec.header.net,
      loc: rec.header.loc,
      origin: rec.header.origin,
      dur: this.procGround.dur,
      fs: rec.header.fs,
      channels: rec.header.channels,
      intensity,
    }
    this.applyBuildingMode()
    this.flash(`讀取完成（JMA 積分漸化式）／計測震度 ${intensity.I.toFixed(1)}（震度${intensity.shindo}）`)
  }
  loadSample() {
    return fetch(`${import.meta.env.BASE_URL}sample.mseed`)
      .then((r) => {
        if (!r.ok) throw new Error("找不到範例檔")
        return r.arrayBuffer()
      })
      .then((buf) => this.loadMseed(buf, "1A3A17C_20260707T044704Z_20260707T044804Z.mseed"))
      .catch((err) => this.flash("範例載入失敗：" + err.message))
  }
  loadSine(dir: "NS" | "EW", T: number, A: number, dur: number) {
    this.procGround = generateSine(dir, T, A, dur)
    this.recordInfo = {
      fileName: `正弦波 ${dir} T=${T}s A=${A}cm`,
      type: "正弦波（合成）",
      dur,
      fs: 100,
      isSine: true,
      sine: { dir, T, A, peakGal: A * ((2 * Math.PI) / T) * ((2 * Math.PI) / T) },
    }
    this.applyBuildingMode()
    this.flash(`正弦波生成：${dir} T=${T}s A=${A}cm`)
  }

  setScene(key: string) {
    if (!SCENES[key]) return
    this.sceneKey = key
    this.running = false
    this.clearFurniture()
    this.buildRoom()
    this.camDist = SCENES[key].cam
    this.updateCam()
    this.initFurnState(key)
    this.placeFurniture()
    this.flash(SCENES[key].label + " 切換")
  }
  setFurn(id: string, partial: Partial<FurnUIState>) {
    if (!this.furn[id]) return
    this.furn[id] = { ...this.furn[id], ...partial }
    this.placeFurniture()
    this.emit()
  }
  /** 僅更新家具參數值並回報（不重建；供輸入框逐字更新使用）。 */
  updateFurnValue(id: string, partial: Partial<FurnUIState>) {
    if (!this.furn[id]) return
    this.furn[id] = { ...this.furn[id], ...partial }
    this.emit()
  }
  /** 提交目前家具設定並重建（供輸入框失焦時使用）。 */
  commitFurn() {
    this.placeFurniture()
    this.emit()
  }
  setBuilding(partial: Partial<{ on: boolean; N: number; floor: number; type: string }>) {
    this.bld = { ...this.bld, ...partial }
    if (this.bld.floor > this.bld.N) this.bld.floor = this.bld.N
    this.applyBuildingMode()
    this.emit()
  }
  setAmpScale(v: number) {
    this.ampScale = v
    this.orbitCache = null
    this.drawOrbit()
    this.updateAccHud()
    this.emit()
  }
  setSpeed(v: number) { this.speed = v; this.emit() }
  setStartSkip(v: number) { this.startSkip = v; this.placeFurniture(); this.emit() }
  setSwap(v: boolean) {
    this.swap = v
    this.orbitCache = null
    this.placeFurniture()
    this.flash(v ? "交換：NS記錄→EW軸 / EW記錄→NS軸" : "正常：NS記錄→NS軸 / EW記錄→EW軸")
  }

  play() {
    if (!this.proc) return
    if (this.running) { this.running = false; this.emit(); return }
    if (this.simT >= this.proc.dur || !this.furniture.length) this.placeFurniture()
    this.running = true
    this.emit()
  }
  stop() { this.placeFurniture(); this.emit() }
  private stopSimCore() {
    this.running = false
    this.simT = this.physT = this.startT()
    if (this.liveRefs.timeEl) this.liveRefs.timeEl.textContent = this.simT.toFixed(1) + " s"
    if (this.proc) this.drawChartsBase()
    this.updateAccHud()
    this.drawOrbit()
  }

  setWaveOpen(v: boolean) {
    this.waveOpen = v
    this.emit()
  }
  setOrbitOpen(v: boolean) {
    this.orbitOpen = v
    if (v) { this.orbitCache = null; this.drawOrbit() }
    this.emit()
  }
  toggleWaveView() {
    this.waveView = this.waveView === "full" ? "win" : "full"
    this.staticCache = null
    if (this.proc) this.drawChartsBase()
    this.emit()
  }

  dispose() {
    this._disposed = true
    cancelAnimationFrame(this._raf)
    removeEventListener("resize", this._onResize)
    this.clearFurniture()
    try {
      this.renderer.dispose()
      if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    } catch (_e) { /* noop */ }
    this.listeners.clear()
  }
}
