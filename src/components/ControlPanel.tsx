import { useEffect, useRef, useState } from "react"
import type { SimEngine, EngineState } from "@/engine/simEngine"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

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

function SecHead({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-medium tracking-widest text-muted-foreground">
      {children}
    </h2>
  )
}

const InfoRow = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-1 leading-6">
    <b className="inline-block w-[5.5em] shrink-0 font-normal text-muted-foreground">{k}</b>
    <span className="min-w-0 break-all">{v}</span>
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
      <div className="px-3 pt-3">
        <h1 className="text-[15px] font-semibold tracking-wide">強震動室內模擬器</h1>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          miniSEED 加速度記錄 → 變位波形 → 振動台加振
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {/* 室內空間 */}
        <div className="border-border/60 border-t py-3">
          <SecHead>室內空間</SecHead>
          <Select value={state.sceneKey} onValueChange={(v) => engine.setScene(v)}>
            <SelectTrigger className="h-8 w-full text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="home">一般住家（和室）</SelectItem>
              <SelectItem value="office">辦公室</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 波形檔案 */}
        <div className="border-border/60 border-t py-3">
          <SecHead>波形檔案（miniSEED）</SecHead>
          <div className="flex gap-1.5">
            <Button className="h-8 flex-1 text-[12px]" onClick={() => fileRef.current?.click()}>
              讀取 mseed 檔案
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".mseed,.seed,application/octet-stream"
              className="hidden"
              onChange={onFile}
            />
          </div>
          <Button
            variant="secondary"
            className="mt-1.5 h-8 w-full text-[12px]"
            onClick={() => engine.loadSample()}
          >
            載入範例波形（3A17C）
          </Button>
          <div className="mt-1.5 text-[10px] break-all text-muted-foreground">
            {rec ? rec.fileName : "未讀取"}
          </div>
          {rec && (
            <div className="mt-1 text-[11px]">
              <InfoRow k="格式" v={rec.type} />
              {rec.isSine && rec.sine ? (
                <>
                  <InfoRow k="方向" v={rec.sine.dir} />
                  <InfoRow k="周期 / 振幅" v={`${rec.sine.T}s / ${rec.sine.A}cm`} />
                  <InfoRow k="理論最大加速度" v={`${rec.sine.peakGal.toFixed(1)} gal`} />
                  <InfoRow k="持續時間" v={`${rec.dur.toFixed(0)}s @ 100Hz（兩端2周期漸變）`} />
                </>
              ) : (
                <>
                  <InfoRow k="測站" v={`${rec.station ?? "?"}（${rec.net ?? "?"}．${rec.loc ?? ""}）`} />
                  {rec.origin && <InfoRow k="起始時刻" v={rec.origin} />}
                  {rec.channels && (
                    <InfoRow
                      k="通道"
                      v={`NS=${rec.channels.NS ?? "—"} EW=${rec.channels.EW ?? "—"} UD=${rec.channels.UD ?? "—"}`}
                    />
                  )}
                  <InfoRow k="持續時間" v={`${rec.dur.toFixed(0)}s @ ${rec.fs}Hz`} />
                </>
              )}
            </div>
          )}
          {rec?.intensity && (
            <div className="border-border/60 mt-1.5 flex items-center justify-between rounded-md border bg-secondary/50 px-2.5 py-1.5">
              <span className="text-[11px] text-muted-foreground">JMA 計測震度（真實）</span>
              <span className="flex items-baseline gap-1.5">
                <span className="font-mono text-xl leading-none text-acc">震度{rec.intensity.shindo}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  I={rec.intensity.I.toFixed(1)}
                </span>
              </span>
            </div>
          )}
          {peaks && (
            <div className="mt-1.5 space-y-0.5">
              <div className="flex justify-between text-[12px]">
                <span>PA 最大 {peaks.tag}</span>
                <span className="font-mono text-acc">{peaks.pga.toFixed(1)} gal</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span>PV 最大 {peaks.tag}</span>
                <span className="font-mono text-vel">{peaks.pgv.toFixed(1)} cm/s</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span>PD 最大 {peaks.tag}</span>
                <span className="font-mono text-dsp">{peaks.pgd.toFixed(1)} cm</span>
              </div>
            </div>
          )}
        </div>

        {/* 家具選擇 */}
        <div className="border-border/60 border-t py-3">
          <SecHead>家具選擇（可多選）</SecHead>
          <div className="space-y-0.5">
            {state.furnDefs.map((f) => {
              const st = state.furn[f.id]
              return (
                <div key={f.id}>
                  <label className="flex cursor-pointer items-center gap-2 py-0.5">
                    <Checkbox
                      checked={st?.on}
                      onCheckedChange={(c) => engine.setFurn(f.id, { on: !!c })}
                    />
                    <span className="text-[12px]">
                      {f.name}
                      {f.unitCount > 1 ? ` ×${f.unitCount}` : ""}
                    </span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{f.spec}</span>
                  </label>
                  <div className="flex items-center gap-1.5 pb-1 pl-6 text-[10px] text-muted-foreground">
                    <span>質量</span>
                    <Num
                      value={st?.mass ?? 0}
                      min={0.5}
                      step={f.lamp ? 0.5 : 1}
                      onCommit={(v) => engine.setFurn(f.id, { mass: v })}
                      className="w-[4.2em]"
                    />
                    <span>kg</span>
                    {!f.lamp && (
                      <>
                        <span className="ml-1">重心高</span>
                        <Num
                          value={st?.cog ?? 50}
                          min={10}
                          max={90}
                          step={5}
                          onCommit={(v) => engine.setFurn(f.id, { cog: v })}
                          className="w-[3.6em]"
                        />
                        <span>%</span>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <Button variant="secondary" className="mt-1.5 h-8 w-full text-[12px]" onClick={() => engine.stop()}>
            室內配置（重設）
          </Button>
        </div>

        {/* 正弦波加振 */}
        <div className="border-border/60 border-t py-3">
          <SecHead>正弦波加振（免記錄）</SecHead>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">方向</span>
              <Select value={sinDir} onValueChange={(v) => setSinDir(v as "NS" | "EW")}>
                <SelectTrigger className="h-7 flex-1 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NS">NS</SelectItem>
                  <SelectItem value="EW">EW</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">周期</span>
              <Num value={sinT} min={0.1} max={10} step={0.1} onCommit={setSinT} className="flex-1" />
              <span className="text-[12px]">s</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">最大變位</span>
              <Num value={sinA} min={0.5} max={200} step={0.5} onCommit={setSinA} className="flex-1" />
              <span className="text-[12px]">cm</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">持續時間</span>
              <Num value={sinDur} min={5} max={120} step={5} onCommit={setSinDur} className="flex-1" />
              <span className="text-[12px]">s</span>
            </div>
            <Button
              variant="secondary"
              className="h-8 w-full text-[12px]"
              onClick={() => engine.loadSine(sinDir, Math.max(0.1, sinT), Math.max(0.1, sinA), Math.max(5, sinDur))}
            >
              生成正弦波並讀取
            </Button>
          </div>
        </div>

        {/* 建物應答 */}
        <div className="border-border/60 border-t py-3">
          <SecHead>建物應答（多質點剪力型模型）</SecHead>
          <label className="flex cursor-pointer items-center gap-2 py-1">
            <Switch checked={state.bld.on} onCheckedChange={(c) => engine.setBuilding({ on: c })} />
            <span className="text-[12px]">於建物樓層加振</span>
          </label>
          <div className="mt-1 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">構造種別</span>
              <Select value={state.bld.type} onValueChange={(v) => engine.setBuilding({ type: v })}>
                <SelectTrigger className="h-7 flex-1 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="S">S造（T₁=0.03H, h=2%）</SelectItem>
                  <SelectItem value="RC">RC造（T₁=0.02H, h=3%）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">層數</span>
              <Num value={state.bld.N} min={3} max={50} step={1} onCommit={(v) => engine.setBuilding({ N: Math.round(v) })} className="flex-1" />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">對象樓層</span>
              <Num value={state.bld.floor} min={1} max={state.bld.N} step={1} onCommit={(v) => engine.setBuilding({ floor: Math.round(v) })} className="flex-1" />
            </div>
          </div>
          {state.bldInfo && (
            <div className="mt-1.5 text-[10px] leading-relaxed whitespace-pre-line text-muted-foreground">
              {state.bldInfo}
            </div>
          )}
        </div>

        {/* 加振 */}
        <div className="border-border/60 border-t py-3">
          <SecHead>加振</SecHead>
          <div ref={timeRef} className="my-1 text-center font-mono text-lg tracking-wide">
            0.0 s
          </div>
          <div className="flex gap-1.5">
            <Button className="h-8 flex-1 text-[12px]" disabled={!state.hasProc} onClick={() => engine.play()}>
              {state.running ? "暫停" : "加振開始"}
            </Button>
            <Button variant="secondary" className="h-8 text-[12px]" disabled={!state.hasProc} onClick={() => engine.stop()}>
              停止
            </Button>
          </div>
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">播放速度</span>
              <Select value={String(state.speed)} onValueChange={(v) => engine.setSpeed(parseFloat(v))}>
                <SelectTrigger className="h-7 flex-1 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.25">0.25×</SelectItem>
                  <SelectItem value="0.5">0.5×</SelectItem>
                  <SelectItem value="1">1.0×</SelectItem>
                  <SelectItem value="2">2.0×</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">起始時刻</span>
              <Num value={state.startSkip} min={0} step={1} onCommit={(v) => engine.setStartSkip(v)} className="flex-1" />
              <span className="text-[12px]">s</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 text-[12px]">振幅倍率</span>
              <Num value={state.ampScale} min={0.1} max={50} step={0.5} onCommit={(v) => engine.setAmpScale(v)} className="flex-1" />
            </div>
            <div className="text-[10px] leading-tight text-muted-foreground">
              ※ 振幅倍率 1.0 為真實比例。弱震（震度1〜3）家具幾乎不動屬正常且正確。提高倍率僅供放大觀察，屬<span className="text-dsp">非真實比例</span>；計測震度與尖峰值恆為真實記錄值，不受倍率影響。
            </div>
            <label className="flex cursor-pointer items-center gap-2 py-0.5">
              <Switch checked={state.swap} onCheckedChange={(c) => engine.setSwap(c)} />
              <span className="text-[12px]">NS↔EW 交換（NS記錄→EW加振）</span>
            </label>
          </div>
        </div>

        {/* 家具狀態 */}
        <div className="border-border/60 border-t py-3">
          <SecHead>家具狀態</SecHead>
          <div ref={statusRef} className="space-y-0.5 text-[11px] leading-relaxed">
            <span className="text-muted-foreground">— 未配置 —</span>
          </div>
        </div>

        <Separator className="my-2" />
        <Button variant="ghost" className="h-7 w-full text-[11px] text-muted-foreground" onClick={onOpenInfo}>
          免責聲明・使用方式・常見問題
        </Button>
      </div>
    </div>
  )
}
