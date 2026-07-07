import { useEffect, useRef } from "react"
import type { SimEngine } from "@/engine/simEngine"

export function AccHud({ engine, ampScale }: { engine: SimEngine; ampScale: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    engine.setLiveRefs({ accEl: ref.current })
  }, [engine])
  const amplified = Math.abs(ampScale - 1) > 1e-6
  return (
    <div className="border-border pointer-events-none absolute top-2.5 left-1/2 z-[9] -translate-x-1/2 rounded-md border bg-background/80 px-4 py-1 text-center backdrop-blur">
      <div className="text-[10px] tracking-wide text-muted-foreground">近 1 秒 最大加速度（合成）</div>
      <span ref={ref} className="font-mono text-2xl text-acc">
        —
      </span>{" "}
      <span className="text-[11px] text-muted-foreground">gal</span>
      {amplified && (
        <div className="mt-0.5 text-[10px] font-medium text-dsp">
          ⚠ 已放大 {ampScale}×（非真實比例）
        </div>
      )}
    </div>
  )
}
