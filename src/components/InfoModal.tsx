import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="mb-1.5 text-[13px] font-semibold text-acc">{title}</h3>
      <ul className="list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-foreground/90">{children}</ul>
    </div>
  )
}

export function InfoModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [tab, setTab] = useState("disc")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[84vh] w-[min(640px,92vw)] flex-col gap-3" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-acc">強震動室內模擬器</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="disc">免責聲明</TabsTrigger>
            <TabsTrigger value="usage">使用方式</TabsTrigger>
            <TabsTrigger value="faq">常見問題</TabsTrigger>
          </TabsList>
          <ScrollArea className="mt-3 h-[52vh] pr-3">
            <TabsContent value="disc" className="mt-0">
              <Section title="免責聲明">
                <li>本模擬器為<b>以教育・防災宣導為目的之簡易物理演算展示</b>，並非用於準確重現或預測實際地震時家具的行為、建物應答與室內災損。</li>
                <li>結果取決於物理引擎的數值計算條件（時間步長、接觸剛度、摩擦模型等），相同輸入在不同設定下可能有很大差異。<span className="text-dsp">請勿將其作為結構設計、耐震診斷、家具固定與否判斷、安全性/危險性評估、保險・法務等任何實務判斷之依據。</span></li>
                <li>對於因模擬結果與本工具之使用或無法使用而產生之任何直接、間接損害，作者概不負責。</li>
                <li>讀取強震記錄（如各國地震觀測網、氣象單位等）時，請遵守各機構規定之資料使用條款與出處標示條件。記錄資料本身不包含於本工具中。</li>
                <li>實際地震的準備（家具固定・配置檢視・避難計畫等），請依政府單位、氣象單位、專業機構之官方資訊及專家建議進行。</li>
              </Section>
              <Section title="物理模型的限制・注意事項">
                <li><b>剛體近似</b>：家具視為不變形・不破損的剛體，不表現抽屜彈出、門扇開闔、收納物散落、玻璃破損等。</li>
                <li><b>摩擦模型</b>：物理引擎的迭代求解器無法表現完全的靜摩擦（固著），故對接觸地面的剛體施加不超過庫倫摩擦上限（μs·N，μs=1.3μk）的輔助摩擦衝量。上限內達到與台面同速（靜摩擦實際行為），超過上限則轉為動摩擦（μk）滑動。摩擦係數為代表值，實際因地材・腳部形狀・老化而大不相同。</li>
                <li><b>碰撞・落地</b>：假設恢復係數為 0 的非彈性碰撞。因時間步長（240Hz）相依的貫入補正，受強烈垂直加速度後的落地瞬間可能出現微小跳動。已以接觸剛度軟化與接觸寬限窗（數步）降低此影響，但無法完全消除。</li>
                <li><b>吊掛物</b>：繩以不可伸長的剛性連結（點對點約束）近似，不表現繩的鬆弛・斷裂。天花板視為剛體，吊掛物會撞上天花板而停止。</li>
                <li><b>建物模型</b>：採用等質量（1000t/層）・等剛性剪力型多質點系的強理想化。不考慮實建物的剛度分布・偏心・非線性（塑性化・損傷）・地盤互制。應答為彈性範圍的概略值。</li>
                <li><b>波形處理</b>：加速度記錄的積分（速度・位移）伴隨高通濾波等處理，長周期成分・永久位移無法準確還原。</li>
              </Section>
            </TabsContent>
            <TabsContent value="usage" className="mt-0">
              <Section title="基本流程">
                <li><b>① 準備波形</b>：於「波形檔案」讀取 miniSEED 三分量加速度記錄（本工具以 10000 counts = 1 cm/s² 換算加速度），或按「載入範例波形」使用內建範例。無記錄時亦可用「正弦波震動」指定方向（NS/EW）・周期・最大位移・持續時間生成合成波（兩端 2 周期漸變）。</li>
                <li><b>② 室內空間</b>：以「室內空間」切換一般住家（和室 4.2×4.2m）／辦公室（6.4×5.2m）。家具・小物可逐項勾選配置，並可調整質量與重心高（%）。重心越高越易傾倒。</li>
                <li><b>③ 建物應答（可選）</b>：開啟「於建物樓層震動」後，以多質點剪力型模型的時刻歷應答解析（Newmark-β 法、Rayleigh 阻尼）求得指定樓層的地板應答（絕對加速度・速度・位移）震動。可指定構造種別（S造：T₁=0.03H・h=2% ／ RC造：T₁=0.02H・h=3%，層高 4m）、層數（3〜50）、對象樓層，並顯示相對地表的 PA 放大率。</li>
                <li><b>④ 震動</b>：按「開始震動」執行。可設定播放速度、振幅倍率、NS↔EW 交換、起始時刻跳過。「回到初始配置」可重複重來。</li>
              </Section>
              <Section title="畫面與操作">
                <li><b>3D 視角</b>：拖曳旋轉、滾輪（縮放）縮放。</li>
                <li><b>波形面板</b>（右上「波形」）：加速度・速度・位移三分量波形與播放游標。右上按鈕可切換「全體顯示 ⇄ 播放時刻±15秒的窗顯示」。縱軸固定為全記錄最大值，可跨窗比較。</li>
                <li><b>位移軌跡</b>（右上「軌跡 NS-EW」）：水平面內的位移軌跡。顯示全軌跡（淡色）、近 2 秒（橙）、目前位置（白點）。</li>
                <li><b>加速度 HUD</b>（畫面上方）：近 1 秒間的最大合成加速度（gal），反映振幅倍率。</li>
                <li><b>狀態面板</b>：顯示各家具的傾斜・移動量・傾倒/移動判定、吊掛物擺角。</li>
              </Section>
              <Section title="觀察提示">
                <li>背高且重心高的家具（書架・文件櫃）在短周期強烈搖晃時易傾倒。</li>
                <li>附滾輪的影印機・辦公椅摩擦小，即使弱搖晃也會大幅移動。</li>
                <li>給予長周期（2〜6秒）大位移的正弦波、或高樓層地板應答時，可觀察超高層在長周期地震動下「緩慢而大」的搖晃與家具滑動。</li>
                <li>改變振幅倍率・質量・重心高，比較同一地震下的行為差異。</li>
              </Section>
            </TabsContent>
            <TabsContent value="faq" className="mt-0">
              <Section title="常見問題">
                <li><b>Q. 支援哪些波形格式？</b><br />A. miniSEED（SEED 2.x）加速度記錄，依方位碼（Z/N/E）分離為 UD/NS/EW 三分量。支援 16/32-bit 整數、浮點及 Steim-1/2 壓縮編碼。以 10000 counts = 1 cm/s² 換算加速度。</li>
                <li><b>Q. gal 是什麼？和震度的關係？</b><br />A. 加速度單位，1 gal = 1 cm/s²，重力加速度約 980 gal。震度不只看加速度，也考量周期與持續時間，故 gal 與震度並非一對一對應。</li>
                <li><b>Q. 「傾倒」「移動」如何判定？</b><br />A. 相對垂直軸的傾斜超過 45° 判為傾倒，相對初始位置的水平移動超過 5cm 判為移動（一旦判定即保持）。</li>
                <li><b>Q. 為何家具會在搖晃途中突然停住？</b><br />A. 這是靜摩擦的表現。當消除與地面相對速度所需的衝量在庫倫摩擦上限（μs·N）以下時固著，超過則以動摩擦滑動。慣性力在摩擦上限附近往返，故反覆「滑動→停止」。</li>
                <li><b>Q. 建物模型的參數？</b><br />A. 層高 4m・各層 1000t 的等質量等剛性剪力型。1 次固有周期使 S造 T₁=0.03H、RC造 T₁=0.02H 逆算剛度，阻尼採 Rayleigh 型（1、2 次模態 S造2%／RC造3%），數值積分為 Newmark-β 法（β=1/4）。</li>
                <li><b>Q. 為何越高樓層搖晃越大？</b><br />A. 接近建物固有周期的成分會共振放大。長周期地震動時，超高層的上層位移可達地表數倍；短周期成分於上層則未必放大。</li>
                <li><b>Q. 吊燈能擺到多大？</b><br />A. 天花板視為剛體，大振幅時吊掛物會撞上天花板而停止（不會穿越天花板翻一圈）。繩為不可伸長的剛性連結近似。</li>
                <li><b>Q. 家具落地瞬間會小跳動？</b><br />A. 這是時間步長（240Hz）相依貫入補正的已知副作用。已以接觸剛度軟化與接觸寬限窗降低，但強烈上下動時可能殘留。</li>
                <li><b>Q. 動作卡頓怎麼辦？</b><br />A. 可減少勾選家具・小物、關閉波形/軌跡面板、關閉其他分頁、降低播放速度。物理演算固定 240Hz，受 CPU 效能影響。</li>
                <li><b>Q. 結果可用於防災對策判斷嗎？</b><br />A. 不可。本工具為體驗行為傾向的教材，家具固定與否或安全性判斷，請依專業機構指引與專家建議。</li>
              </Section>
            </TabsContent>
          </ScrollArea>
        </Tabs>
        <DialogFooter>
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            {tab === "disc" ? "同意並開始" : "關閉"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
