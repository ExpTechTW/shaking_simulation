import { useEffect, useRef } from "react"
import type { SimEngine, EngineState } from "@/engine/simEngine"
import { Button } from "@/components/ui/button"

const Dot = ({ color, label }: { color: string; label: string }) => (
  <span className="inline-flex items-center gap-1">
    <i className="inline-block h-0.5 w-2.5 align-middle" style={{ background: color }} />
    {label}
  </span>
)

export function WaveDrawer({ engine, state }: { engine: SimEngine; state: EngineState }) {
  const cA = useRef<HTMLCanvasElement>(null)
  const cV = useRef<HTMLCanvasElement>(null)
  const cD = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const list = [cA.current, cV.current, cD.current].filter(Boolean) as HTMLCanvasElement[]
    engine.setChartCanvases(list)
    return () => engine.setChartCanvases(null)
  }, [engine])

  const p = state.peaks
  const chart = (
    ref: React.RefObject<HTMLCanvasElement | null>,
    label: string,
    color: string,
    val?: number,
  ) => (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-0.5 flex justify-between text-[11px]">
        <span style={{ color }}>{label}</span>
        <span className="font-mono text-muted-foreground">{val != null ? val.toFixed(1) : ""}</span>
      </div>
      <canvas
        ref={ref}
        className="border-border w-full flex-1 rounded-[3px] border bg-[#10151c]"
      />
    </div>
  )

  return (
    <div className="border-border absolute top-0 right-0 bottom-0 z-10 flex w-[340px] flex-col gap-2 border-l bg-background/90 p-2.5 backdrop-blur">
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <Dot color="var(--ns)" label="NS" />
        <Dot color="var(--ew)" label="EW" />
        <Dot color="var(--ud)" label="UD" />
        <Button
          variant="secondary"
          className="ml-auto h-5 px-2 text-[10px]"
          onClick={() => engine.toggleWaveView()}
        >
          {state.waveView === "full" ? "全體" : "±15秒"}
        </Button>
      </div>
      {chart(cA, "加速度 (gal)", "var(--acc)", p?.pga)}
      {chart(cV, "速度 (cm/s)", "var(--vel)", p?.pgv)}
      {chart(cD, "位移 (cm)", "var(--dsp)", p?.pgd)}
    </div>
  )
}
