import { useEffect, useRef } from "react"
import type { SimEngine } from "@/engine/simEngine"

export function OrbitPanel({ engine, shift }: { engine: SimEngine; shift: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    engine.setOrbitCanvas(ref.current)
    return () => engine.setOrbitCanvas(null)
  }, [engine])
  return (
    <div
      className="border-border absolute bottom-4 z-20 rounded-md border bg-background/90 p-2 backdrop-blur transition-[left]"
      style={{ left: shift ? "264px" : "12px" }}
    >
      <h2 className="mb-1 text-[10px] tracking-wide text-muted-foreground">變位軌跡（水平面 NS-EW）</h2>
      <canvas ref={ref} className="border-border h-[230px] w-[230px] rounded-[3px] border bg-[#10151c]" />
    </div>
  )
}
