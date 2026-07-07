import { useEffect, useRef, useState } from "react"
import { SimEngine, type EngineState } from "@/engine/simEngine"
import { ControlPanel } from "@/components/ControlPanel"
import { WaveDrawer } from "@/components/WaveDrawer"
import { OrbitPanel } from "@/components/OrbitPanel"
import { AccHud } from "@/components/AccHud"
import { InfoModal } from "@/components/InfoModal"
import { Button } from "@/components/ui/button"

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
  const shiftRight = waveOpen ? "350px" : "10px"

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
      <Button
        variant="secondary"
        className="absolute top-2.5 z-40 h-8 text-[12px] transition-[left] duration-200"
        style={{ left: panelOpen ? "264px" : "10px" }}
        onClick={() => setPanelOpen((v) => !v)}
      >
        {panelOpen ? "≪ 面板" : "≫ 面板"}
      </Button>

      {/* 右側切換按鈕群 */}
      {engine && state && (
        <>
          <Button
            variant="secondary"
            className="absolute top-2.5 z-40 h-8 text-[12px] transition-[right] duration-200"
            style={{ right: shiftRight }}
            onClick={() => engine.setWaveOpen(!waveOpen)}
          >
            波形 顯示/隱藏
          </Button>
          <Button
            variant="secondary"
            className="absolute top-[44px] z-40 h-8 text-[12px] transition-[right] duration-200"
            style={{ right: shiftRight }}
            onClick={() => engine.setOrbitOpen(!orbitOpen)}
          >
            軌跡 NS-EW
          </Button>
          <Button
            variant="secondary"
            className="absolute top-[78px] z-40 h-[30px] w-[30px] rounded-full p-0 text-[15px] font-bold transition-[right] duration-200"
            style={{ right: shiftRight }}
            title="免責聲明・使用方式・常見問題"
            onClick={() => setModalOpen(true)}
          >
            ？
          </Button>
        </>
      )}

      {/* HUD / 面板 */}
      {engine && <AccHud engine={engine} ampScale={state?.ampScale ?? 1} />}
      {engine && waveOpen && state && <WaveDrawer engine={engine} state={state} />}
      {engine && orbitOpen && <OrbitPanel engine={engine} shift={panelOpen} />}

      {/* 提示訊息 */}
      {toast && (
        <div className="border-border absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-md border bg-secondary px-3.5 py-1.5 text-[12px]">
          {toast}
        </div>
      )}

      <InfoModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  )
}
