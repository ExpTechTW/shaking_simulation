/* =====================================================================
 * 家具目錄（貼近現實的尺寸・質量・摩擦）— 依場景區分
 *   units: 同品項多處配置（pos, face=90°單位旋轉, y0=地面/桌面高度）
 * ===================================================================== */

export interface FurnUnit {
  pos: [number, number]
  face?: number
  y0?: number
}

export interface FurnDef {
  id: string
  name: string
  kind: string
  w?: number
  d?: number
  h?: number
  mass: number
  mu?: number
  color: number
  pos?: [number, number]
  face?: number
  on?: boolean
  seatH?: number
  headH?: number
  lamp?: boolean
  cord?: number
  len?: number
  ped?: number
  units?: FurnUnit[]
}

export interface SceneDef {
  label: string
  W: number
  D: number
  H: number
  floor: number
  base: number
  cam: number
  tile: number
  furn: FurnDef[]
}

export const FURN_HOME: FurnDef[] = [
  { id: "bookshelf", name: "書架（高）", kind: "box", w: 0.9, d: 0.3, h: 1.8, mass: 70, mu: 0.3, color: 0x8a5a33, pos: [-1.5, -1.55], face: 0, on: true },
  { id: "chest", name: "衣櫃（矮）", kind: "box", w: 0.9, d: 0.45, h: 0.9, mass: 45, mu: 0.35, color: 0xa9825a, on: true, pos: [-0.2, -1.5], face: 0 },
  { id: "desk", name: "書桌", kind: "desk", w: 1.2, d: 0.7, h: 0.72, mass: 25, mu: 0.45, color: 0x9c8a6e, on: true, pos: [1.2, -1.55], face: 0 },
  { id: "chair", name: "椅子", kind: "chair", w: 0.42, d: 0.42, h: 0.82, seatH: 0.44, mass: 5, mu: 0.4, color: 0x5a6b7d, on: true, pos: [1.2, -0.7], face: 0 },
  { id: "bed", name: "床", kind: "bed", w: 1.95, d: 0.97, h: 0.45, headH: 0.85, mass: 35, mu: 0.4, color: 0x6e4f33, pos: [1.35, 0.9], face: 1, on: true },
  { id: "fridge", name: "冰箱", kind: "box", w: 0.65, d: 0.7, h: 1.8, mass: 90, mu: 0.25, color: 0xc4ccd4, pos: [-1.55, 0.9], face: 0, on: true },
  { id: "lamp", name: "吊燈（自天花板懸吊）", kind: "lamp", lamp: true, mass: 1.5, cord: 1.2, color: 0xf5e3a0, pos: [0.3, 0.1], on: true },
  { id: "shelftop", name: "書架上的花瓶", kind: "box", w: 0.12, d: 0.12, h: 0.24, mass: 1.2, mu: 0.35, color: 0x7a9aa8, on: true, units: [{ pos: [-1.65, -1.55], y0: 1.8 }] },
  { id: "deskbooks", name: "桌上的書", kind: "box", w: 0.22, d: 0.16, h: 0.05, mass: 0.8, mu: 0.45, color: 0x8a3b2e, on: true, units: [{ pos: [1.45, -1.6], y0: 0.72 }, { pos: [1.44, -1.61], face: 0, y0: 0.775 }] },
  { id: "clock", name: "鬧鐘", kind: "box", w: 0.11, d: 0.06, h: 0.13, mass: 0.4, mu: 0.45, color: 0xc4553a, on: true, units: [{ pos: [0.95, -1.55], y0: 0.72 }] },
  { id: "chesttop", name: "櫃上的相框", kind: "box", w: 0.16, d: 0.04, h: 0.2, mass: 0.5, mu: 0.4, color: 0x5a4a38, on: true, units: [{ pos: [-0.2, -1.55], y0: 0.9 }] },
]

/* 辦公室：室 6.4×5.2m。島型對坐桌・單/雙抽屜桌・滾輪椅・
   文件櫃・紙箱・隔間屏風・桌上PC/螢幕・影印機・兩端吊 LED */
export const FURN_OFFICE: FurnDef[] = [
  { id: "ledbar", name: "LED 燈管（兩端懸吊）", kind: "lampbar", lamp: true, mass: 3, cord: 0.5, len: 1.25, color: 0xf4f7fb, on: true, units: [{ pos: [-1.5, -1.0] }, { pos: [1.1, -1.0] }, { pos: [-1.5, 1.2] }, { pos: [1.1, 1.2] }] },
  { id: "fdesk", name: "平桌（島型對坐）", kind: "pdesk", ped: 0, w: 1.2, d: 0.7, h: 0.7, mass: 22, mu: 0.3, color: 0xe9ebee, on: true, units: [{ pos: [-1.5, -0.42], face: 0 }, { pos: [-1.5, 0.42], face: 2 }] },
  { id: "sdesk", name: "單抽屜桌", kind: "pdesk", ped: 1, w: 1.2, d: 0.7, h: 0.7, mass: 32, mu: 0.3, color: 0xe4e7eb, on: true, units: [{ pos: [1.3, -1.85], face: 0 }] },
  { id: "ddesk", name: "雙抽屜桌", kind: "pdesk", ped: 2, w: 1.4, d: 0.75, h: 0.72, mass: 48, mu: 0.3, color: 0xdfe2e6, on: true, units: [{ pos: [2.35, 1.4], face: 1 }] },
  { id: "ochair", name: "辦公椅（滾輪）", kind: "ochair", w: 0.48, d: 0.48, h: 0.92, seatH: 0.46, mass: 12, mu: 0.08, color: 0x2f3a46, on: true, units: [{ pos: [-1.5, -1.08], face: 2 }, { pos: [-1.5, 1.08], face: 0 }, { pos: [1.3, -1.12], face: 0 }, { pos: [1.5, 1.4], face: 3 }] },
  { id: "monitor", name: "液晶螢幕（桌上）", kind: "monitor", w: 0.55, d: 0.18, h: 0.42, mass: 5, mu: 0.35, color: 0x14181d, on: true, units: [{ pos: [-1.5, -0.24], face: 2, y0: 0.7 }, { pos: [-1.5, 0.24], face: 0, y0: 0.7 }, { pos: [1.3, -2.0], face: 0, y0: 0.7 }, { pos: [2.52, 1.4], face: 3, y0: 0.72 }] },
  { id: "minipc", name: "小型主機（桌上）", kind: "box", w: 0.1, d: 0.32, h: 0.34, mass: 5, mu: 0.35, color: 0x2a2f36, on: true, units: [{ pos: [1.74, -1.85], face: 0, y0: 0.7 }, { pos: [2.3, 0.95], face: 1, y0: 0.72 }] },
  { id: "cab", name: "文件櫃", kind: "cabinet", w: 0.88, d: 0.42, h: 1.85, mass: 65, mu: 0.28, color: 0xc9ced4, on: true, units: [{ pos: [-2.4, -2.3], face: 0 }, { pos: [-1.45, -2.3], face: 0 }] },
  { id: "cbox", name: "紙箱（堆疊）", kind: "box", w: 0.48, d: 0.36, h: 0.33, mass: 7, mu: 0.45, color: 0xb08d57, on: true, units: [{ pos: [2.7, -2.25], y0: 0 }, { pos: [2.7, -2.25], y0: 0.335 }, { pos: [2.68, -2.23], y0: 0.67 }, { pos: [2.7, -1.72], y0: 0 }] },
  { id: "part", name: "隔間屏風", kind: "partition", w: 1.2, d: 0.45, h: 1.6, mass: 14, mu: 0.35, color: 0x7f8fa0, on: true, units: [{ pos: [0.2, -0.15], face: 1 }, { pos: [0.2, 1.05], face: 1 }] },
  { id: "copier", name: "影印機（附滾輪）", kind: "copier", w: 0.62, d: 0.68, h: 1.1, mass: 110, mu: 0.05, color: 0xe3e6ea, on: true, units: [{ pos: [-2.6, 1.9], face: 1 }] },
  { id: "keybd", name: "鍵盤（桌上）", kind: "box", w: 0.36, d: 0.14, h: 0.025, mass: 0.8, mu: 0.4, color: 0x22272e, on: true, units: [{ pos: [-1.5, -0.55], face: 0, y0: 0.7 }, { pos: [-1.5, 0.55], face: 0, y0: 0.7 }, { pos: [1.3, -1.66], face: 0, y0: 0.7 }, { pos: [2.12, 1.4], face: 1, y0: 0.72 }] },
  { id: "mug", name: "馬克杯（桌上）", kind: "box", w: 0.08, d: 0.08, h: 0.095, mass: 0.35, mu: 0.35, color: 0xc4553a, on: true, units: [{ pos: [-1.1, -0.6], y0: 0.7 }, { pos: [-1.9, 0.6], y0: 0.7 }] },
  { id: "phone", name: "電話（桌上）", kind: "box", w: 0.2, d: 0.22, h: 0.07, mass: 1.0, mu: 0.45, color: 0x30363e, on: true, units: [{ pos: [2.35, 1.9], face: 1, y0: 0.72 }] },
  { id: "docs", name: "文件堆", kind: "box", w: 0.3, d: 0.22, h: 0.06, mass: 1.5, mu: 0.35, color: 0xdfe3e8, on: true, units: [{ pos: [-2.4, -2.3], y0: 1.85 }, { pos: [0.95, -1.95], y0: 0.7 }] },
]

export const SCENES: Record<string, SceneDef> = {
  home: { label: "一般住家（和室）", W: 4.2, D: 4.2, H: 2.4, floor: 0xb9a988, base: 0x6b7686, cam: 8.2, tile: 0, furn: FURN_HOME },
  office: { label: "辦公室", W: 6.4, D: 5.2, H: 2.6, floor: 0x9aa0a8, base: 0x5c646e, cam: 10.8, tile: 0.5, furn: FURN_OFFICE },
}
