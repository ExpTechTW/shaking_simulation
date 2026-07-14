import { useEffect, useRef, useState } from "react"
import { SimEngine, type EngineState } from "@/engine/simEngine"
import { ControlPanel } from "@/components/ControlPanel"
import { WaveDrawer } from "@/components/WaveDrawer"
import { OrbitPanel } from "@/components/OrbitPanel"
import { AccHud } from "@/components/AccHud"
import { InfoModal } from "@/components/InfoModal"
import { cn } from "@/lib/utils"
import { PanelLeftClose, PanelLeftOpen, Activity, Orbit, Info } from "lucide-react"

/** 浮動圖示切換鈕（含 active 高亮狀態） */
function IconToggle({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "flex size-9 items-center justify-center rounded-md border backdrop-blur transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card/80 text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

export default function App() {
  const viewRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<SimEngine | null>(null)
  const [state, setState] = useState<EngineState | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [modalOpen, setModalOpen] = useState(true)
  const [toast, setToast] = useState("")

  useEffect(() => {
    if (!viewRef.current) return
    const eng = new SimEngine(viewRef.current)
    setEngine(eng)
    const unsub = eng.subscribe(setState)
    if (import.meta.env.DEV) (window as unknown as { __engine: SimEngine }).__engine = eng
    return () => {
      unsub()
      eng.dispose()
      setEngine(null)
    }
  }, [])

  // 提示訊息（暫顯）
  useEffect(() => {
    if (!state?.message) return
    setToast(state.message)
    const t = setTimeout(() => setToast(""), 2600)
    return () => clearTimeout(t)
  }, [state?.msgId, state?.message])

  const waveOpen = !!state?.waveOpen
  const orbitOpen = !!state?.orbitOpen
  const shiftRight = waveOpen ? 350 : 10

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* 3D 視圖 */}
      <div ref={viewRef} className="absolute inset-0" />

      {/* 左側控制面板 */}
      <div
        className="border-border absolute top-0 bottom-0 left-0 z-30 w-[252px] border-r bg-card transition-transform duration-200"
        style={{ transform: panelOpen ? "translateX(0)" : "translateX(-100%)" }}
      >
        {engine && state && <ControlPanel engine={engine} state={state} onOpenInfo={() => setModalOpen(true)} />}
      </div>

      {/* 面板開闔 */}
      <div
        className="absolute top-2.5 z-40 transition-[left] duration-200"
        style={{ left: panelOpen ? 264 : 10 }}
      >
        <IconToggle title={panelOpen ? "收合面板" : "展開面板"} onClick={() => setPanelOpen((v) => !v)}>
          {panelOpen ? <PanelLeftClose className="size-4.5" /> : <PanelLeftOpen className="size-4.5" />}
        </IconToggle>
      </div>

      {/* 右上工具列 */}
      {engine && state && (
        <div
          className="absolute top-2.5 z-40 flex flex-col gap-1.5 transition-[right] duration-200"
          style={{ right: shiftRight }}
        >
          <IconToggle active={waveOpen} title="波形圖" onClick={() => engine.setWaveOpen(!waveOpen)}>
            <Activity className="size-4.5" />
          </IconToggle>
          <IconToggle active={orbitOpen} title="位移軌跡 NS-EW" onClick={() => engine.setOrbitOpen(!orbitOpen)}>
            <Orbit className="size-4.5" />
          </IconToggle>
          <IconToggle title="說明・免責聲明・常見問題" onClick={() => setModalOpen(true)}>
            <Info className="size-4.5" />
          </IconToggle>
        </div>
      )}

      {/* HUD / 面板 */}
      {engine && <AccHud engine={engine} ampScale={state?.ampScale ?? 1} />}
      {engine && waveOpen && state && <WaveDrawer engine={engine} state={state} />}
      {engine && orbitOpen && <OrbitPanel engine={engine} shift={panelOpen} />}

      {/* 提示訊息 */}
      {toast && (
        <div className="border-border animate-in fade-in slide-in-from-bottom-2 absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border bg-card/95 px-4 py-1.5 text-[12px] shadow-lg backdrop-blur">
          {toast}
        </div>
      )}

      <InfoModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  )
}
