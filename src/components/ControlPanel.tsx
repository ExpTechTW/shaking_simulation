import { useEffect, useRef, useState } from "react"
import type { SimEngine, EngineState } from "@/engine/simEngine"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion"
import { FolderOpen, Play, Pause, Square, Waves, Building2, Sliders, RotateCcw, Info } from "lucide-react"

/* 失焦/Enter 時提交的數值輸入 */
function Num({
  value,
  onCommit,
  min,
  max,
  step,
  className,
}: {
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  step?: number
  className?: string
}) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = () => {
    const n = parseFloat(v)
    if (!Number.isNaN(n)) onCommit(n)
    else setV(String(value))
  }
  return (
    <Input
      type="number"
      value={v}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
      }}
      className={"h-7 px-2 py-0 text-[12px] " + (className ?? "")}
    />
  )
}

/** 標籤 + 控制項的一列（統一對齊） */
function Field({ label, unit, children }: { label: string; unit?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <div className="flex flex-1 items-center gap-1.5">{children}</div>
      {unit && <span className="text-[11px] text-muted-foreground">{unit}</span>}
    </div>
  )
}

function Section({
  value,
  icon,
  title,
  children,
}: {
  value: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <AccordionItem value={value} className="border-border/60">
      <AccordionTrigger className="py-2.5 text-[12px] font-medium hover:no-underline">
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-3">{children}</AccordionContent>
    </AccordionItem>
  )
}

const InfoRow = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-2 leading-6">
    <span className="w-[4.5em] shrink-0 text-muted-foreground">{k}</span>
    <span className="min-w-0 flex-1 break-all">{v}</span>
  </div>
)

export function ControlPanel({
  engine,
  state,
  onOpenInfo,
}: {
  engine: SimEngine
  state: EngineState
  onOpenInfo: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  const [showParams, setShowParams] = useState(false)

  // 正弦波參數（本地）
  const [sinDir, setSinDir] = useState<"NS" | "EW">("NS")
  const [sinT, setSinT] = useState(1.0)
  const [sinA, setSinA] = useState(10)
  const [sinDur, setSinDur] = useState(30)

  useEffect(() => {
    engine.setLiveRefs({ timeEl: timeRef.current, statusEl: statusRef.current })
  }, [engine])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const buf = await file.arrayBuffer()
    engine.loadMseed(buf, file.name)
    e.target.value = ""
  }

  const rec = state.record
  const peaks = state.peaks

  return (
    <div className="flex h-full flex-col">
      {/* 標題 */}
      <div className="px-3.5 pt-3.5 pb-2">
        <h1 className="text-[15px] font-semibold tracking-wide">強震動室內模擬器</h1>
        <div className="mt-0.5 text-[10px] text-muted-foreground">miniSEED 記錄 → 地動加速度 → 家具反應</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-4">
        {/* ── 主控台（永遠可見）：讀取 → 計測震度 → 震動 ── */}
        <div className="border-border/70 bg-secondary/25 space-y-3 rounded-lg border p-3">
          {/* 讀取波形 */}
          <div>
            <div className="mb-1.5 text-[10px] font-medium tracking-wider text-muted-foreground">① 波形來源</div>
            <div className="flex gap-1.5">
              <Button className="h-8 flex-1 gap-1.5 text-[12px]" onClick={() => fileRef.current?.click()}>
                <FolderOpen className="size-3.5" /> 讀取檔案
              </Button>
              <Button variant="secondary" className="h-8 text-[12px]" onClick={() => engine.loadSample()}>
                範例
              </Button>
            </div>
            <input ref={fileRef} type="file" accept=".mseed,.seed,application/octet-stream" className="hidden" onChange={onFile} />
            <div className="mt-1.5 truncate text-[10px] text-muted-foreground" title={rec?.fileName}>
              {rec ? rec.fileName : "尚未讀取波形，請讀取檔案或載入範例"}
            </div>
          </div>

          {/* 計測震度 + 尖峰值 */}
          {rec?.intensity && (
            <div className="border-border/60 flex items-center justify-between rounded-md border bg-background/60 px-3 py-2">
              <div>
                <div className="text-[10px] text-muted-foreground">JMA 計測震度</div>
                <div className="font-mono text-2xl leading-tight text-acc">震度{rec.intensity.shindo}</div>
              </div>
              {peaks && (
                <div className="space-y-0.5 text-right text-[11px]">
                  <div>
                    PGA <span className="font-mono text-acc">{peaks.pga.toFixed(0)}</span> gal
                  </div>
                  <div>
                    PGV <span className="font-mono text-vel">{peaks.pgv.toFixed(1)}</span> cm/s
                  </div>
                  <div>
                    PGD <span className="font-mono text-dsp">{peaks.pgd.toFixed(1)}</span> cm
                  </div>
                </div>
              )}
            </div>
          )}
          {rec?.isSine && rec.sine && (
            <div className="border-border/60 rounded-md border bg-background/60 px-3 py-2 text-[11px]">
              <div className="text-[10px] text-muted-foreground">正弦波（合成）</div>
              <div className="font-mono">
                {rec.sine.dir} · T={rec.sine.T}s · A={rec.sine.A}cm · 峰值 {rec.sine.peakGal.toFixed(0)} gal
              </div>
            </div>
          )}

          {/* 震動控制 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-medium tracking-wider text-muted-foreground">② 震動</span>
              <span ref={timeRef} className="font-mono text-[13px] tabular-nums">0.0 s</span>
            </div>
            <div className="flex gap-1.5">
              <Button className="h-9 flex-1 gap-1.5 text-[13px]" disabled={!state.hasProc} onClick={() => engine.play()}>
                {state.running ? <Pause className="size-4" /> : <Play className="size-4" />}
                {state.running ? "暫停" : "開始震動"}
              </Button>
              <Button variant="secondary" className="h-9 gap-1.5 text-[12px]" disabled={!state.hasProc} onClick={() => engine.stop()}>
                <Square className="size-3.5" /> 停止
              </Button>
            </div>
          </div>
        </div>

        {/* ── 收合式設定 ── */}
        <Accordion type="multiple" defaultValue={["furniture"]} className="mt-1">
          {/* 播放設定 */}
          <Section value="playback" icon={<Sliders className="size-3.5" />} title="播放設定">
            <div className="space-y-2">
              <Field label="播放速度">
                <Select value={String(state.speed)} onValueChange={(v) => engine.setSpeed(parseFloat(v))}>
                  <SelectTrigger className="h-7 flex-1 text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.25">0.25×（慢動作）</SelectItem>
                    <SelectItem value="0.5">0.5×</SelectItem>
                    <SelectItem value="1">1.0×（實際）</SelectItem>
                    <SelectItem value="2">2.0×</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="起始時刻" unit="s">
                <Num value={state.startSkip} min={0} step={1} onCommit={(v) => engine.setStartSkip(v)} className="flex-1" />
              </Field>
              <Field label="振幅倍率" unit="×">
                <Num value={state.ampScale} min={0.1} max={50} step={0.5} onCommit={(v) => engine.setAmpScale(v)} className="flex-1" />
              </Field>
              <label className="flex cursor-pointer items-center justify-between py-0.5">
                <span className="text-[12px] text-muted-foreground">NS↔EW 交換</span>
                <Switch checked={state.swap} onCheckedChange={(c) => engine.setSwap(c)} />
              </label>
              <p className="text-[10px] leading-snug text-muted-foreground">
                振幅倍率 1.0 為真實比例。弱震家具幾乎不動屬正常；提高倍率僅供放大觀察，屬
                <span className="text-dsp">非真實比例</span>（計測震度與尖峰值不受影響）。
              </p>
            </div>
          </Section>

          {/* 室內與家具 */}
          <Section value="furniture" icon={<span className="text-[13px]">🛋</span>} title="室內空間與家具">
            <div className="space-y-2.5">
              <Field label="室內空間">
                <Select value={state.sceneKey} onValueChange={(v) => engine.setScene(v)}>
                  <SelectTrigger className="h-7 flex-1 text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="home">一般住家（和室）</SelectItem>
                    <SelectItem value="office">辦公室</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">家具選擇（可多選）</span>
                <button
                  className={
                    "text-[10px] transition-colors " +
                    (showParams ? "text-foreground" : "text-muted-foreground hover:text-foreground")
                  }
                  onClick={() => setShowParams((s) => !s)}
                >
                  {showParams ? "▾ 隱藏參數" : "▸ 質量/重心"}
                </button>
              </div>

              <div className="space-y-0.5">
                {state.furnDefs.map((f) => {
                  const st = state.furn[f.id]
                  return (
                    <div key={f.id} className="rounded-sm hover:bg-secondary/40">
                      <label className="flex cursor-pointer items-center gap-2 px-1 py-1">
                        <Checkbox checked={st?.on} onCheckedChange={(c) => engine.setFurn(f.id, { on: !!c })} />
                        <span className="text-[12px]">
                          {f.name}
                          {f.unitCount > 1 ? ` ×${f.unitCount}` : ""}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">{f.spec}</span>
                      </label>
                      {showParams && (
                        <div className="flex items-center gap-1.5 px-1 pb-1.5 pl-7 text-[10px] text-muted-foreground">
                          <span>質量</span>
                          <Num value={st?.mass ?? 0} min={0.5} step={f.lamp ? 0.5 : 1} onCommit={(v) => engine.setFurn(f.id, { mass: v })} className="w-[4em]" />
                          <span>kg</span>
                          {!f.lamp && (
                            <>
                              <span className="ml-1">重心</span>
                              <Num value={st?.cog ?? 50} min={10} max={90} step={5} onCommit={(v) => engine.setFurn(f.id, { cog: v })} className="w-[3.4em]" />
                              <span>%</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <Button variant="secondary" className="h-8 w-full gap-1.5 text-[12px]" onClick={() => engine.stop()}>
                <RotateCcw className="size-3.5" /> 重新配置家具
              </Button>
            </div>
          </Section>

          {/* 正弦波產生 */}
          <Section value="sine" icon={<Waves className="size-3.5" />} title="正弦波震動（免記錄）">
            <div className="space-y-2">
              <Field label="方向">
                <Select value={sinDir} onValueChange={(v) => setSinDir(v as "NS" | "EW")}>
                  <SelectTrigger className="h-7 flex-1 text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NS">NS（南北）</SelectItem>
                    <SelectItem value="EW">EW（東西）</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="周期" unit="s">
                <Num value={sinT} min={0.1} max={10} step={0.1} onCommit={setSinT} className="flex-1" />
              </Field>
              <Field label="最大位移" unit="cm">
                <Num value={sinA} min={0.5} max={200} step={0.5} onCommit={setSinA} className="flex-1" />
              </Field>
              <Field label="持續時間" unit="s">
                <Num value={sinDur} min={5} max={120} step={5} onCommit={setSinDur} className="flex-1" />
              </Field>
              <Button
                variant="secondary"
                className="h-8 w-full text-[12px]"
                onClick={() => engine.loadSine(sinDir, Math.max(0.1, sinT), Math.max(0.1, sinA), Math.max(5, sinDur))}
              >
                生成並讀取正弦波
              </Button>
            </div>
          </Section>

          {/* 建物應答 */}
          <Section value="building" icon={<Building2 className="size-3.5" />} title="建物應答（進階）">
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center justify-between py-0.5">
                <span className="text-[12px]">於建物樓層震動</span>
                <Switch checked={state.bld.on} onCheckedChange={(c) => engine.setBuilding({ on: c })} />
              </label>
              <Field label="構造種別">
                <Select value={state.bld.type} onValueChange={(v) => engine.setBuilding({ type: v })}>
                  <SelectTrigger className="h-7 flex-1 text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="S">S造（T₁=0.03H）</SelectItem>
                    <SelectItem value="RC">RC造（T₁=0.02H）</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="層數">
                <Num value={state.bld.N} min={3} max={50} step={1} onCommit={(v) => engine.setBuilding({ N: Math.round(v) })} className="flex-1" />
              </Field>
              <Field label="對象樓層">
                <Num value={state.bld.floor} min={1} max={state.bld.N} step={1} onCommit={(v) => engine.setBuilding({ floor: Math.round(v) })} className="flex-1" />
              </Field>
              {state.bldInfo && (
                <div className="text-[10px] leading-relaxed whitespace-pre-line text-muted-foreground">{state.bldInfo}</div>
              )}
            </div>
          </Section>
        </Accordion>

        {/* ── 家具狀態（永遠可見） ── */}
        <div className="border-border/60 mt-3 border-t pt-3">
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">家具狀態</div>
          <div ref={statusRef} className="space-y-0.5 text-[11px] leading-relaxed">
            <span className="text-muted-foreground">— 未配置 —</span>
          </div>
        </div>

        <Button variant="ghost" className="mt-3 h-8 w-full gap-1.5 text-[11px] text-muted-foreground" onClick={onOpenInfo}>
          <Info className="size-3.5" /> 免責聲明・使用方式・常見問題
        </Button>
      </div>
    </div>
  )
}
