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
                <li>結果取決於物理引擎的數值條件（時間步長、接觸剛度、摩擦係數等），相同輸入在不同設定下可能有差異。<span className="text-dsp">請勿將其作為結構設計、耐震診斷、家具固定與否判斷、安全性評估、保險・法務等任何實務判斷之依據。</span></li>
                <li>對於因模擬結果與本工具之使用或無法使用而產生之任何直接、間接損害，作者概不負責。</li>
                <li>讀取強震記錄時，請遵守各觀測機構（地震網、氣象單位等）之資料利用規約與出處標示條件。記錄資料本身不包含於本工具中。</li>
                <li>實際地震的準備（家具固定・配置檢視・避難計畫等），請依政府、氣象單位、專業機構之官方資訊與專家建議進行。</li>
              </Section>
              <Section title="物理模型的方法與限制">
                <li>
                  <b>驅動方式（非慣性座標系／偽力）</b>：房間（地板/牆/天花板）於物理上<b>固定不動</b>，將當下的地動加速度 a 以偽力
                  <span className="font-mono"> −m·a</span> 施加於每個剛體（等同結構動力學的「有效地震力」
                  <span className="font-mono">p=−m·a_g</span>、D'Alembert 原理）；視覺上再把場景依地動位移平移以呈現房間搖晃。如此家具感受到的是<b>真實的地動加速度（含高頻）</b>，不會在「以位移驅動→接觸傳遞」中流失。
                </li>
                <li>
                  <b>摩擦・傾倒・滑動（三區判定）</b>：依台面水平加速度 a<sub>H</sub> 分三區——低於兩臨界時靜止（不潛移）；超過<b>滑動臨界</b>
                  <span className="font-mono"> μs·g</span>（庫倫；μs=1.3μk）以庫倫滑塊模型滑動；超過<b>傾倒臨界</b>
                  <span className="font-mono"> g·(半底寬/重心高)</span> 則交由接觸求解器繞底邊傾倒/搖擺。摩擦係數為代表值，實際因地材・腳形・老化而異。
                </li>
                <li>
                  <b>頻率相依（重要）</b>：傾倒不只取決於加速度大小，也取決於頻率/速度（Ishiyama 加速度＋速度雙判據）。<b>高頻</b>晃動（如卓越 ~9Hz 的近斷層記錄）即使加速度很大，每次推力太短促，大型家具多半只搖不倒；但傾倒門檻低的小物（花瓶・相框）會被拋落。<b>長周期／大速度脈衝</b>才會使大型家具真正傾倒。
                </li>
                <li><b>剛體近似</b>：家具為不變形・不破損的剛體，不表現抽屜彈出、門扇開闔、收納物散落、玻璃破損等。</li>
                <li><b>碰撞・吊掛物</b>：恢復係數 0 的非彈性碰撞；強烈垂直加速度後的落地瞬間可能有微小跳動（240Hz 貫入補正）。吊燈以不可伸長剛性連結近似，會撞上剛性天花板而停止。</li>
                <li><b>建物模型</b>：等質量（1000t/層）・等剛性剪力型多質點系的強理想化，不含實建物的剛度分布・偏心・非線性・地盤互制，應答為彈性範圍概略值。</li>
                <li><b>波形處理</b>：加速度積分為速度・位移採氣象廳積分遞迴式，長周期成分・永久位移無法準確還原。</li>
              </Section>
            </TabsContent>
            <TabsContent value="usage" className="mt-0">
              <Section title="基本流程（左側面板）">
                <li>
                  <b>① 波形來源</b>：於主控台按「讀取檔案」載入 miniSEED 三分量加速度記錄，或按「範例」使用內建範例。讀取後立即顯示 <b>JMA 計測震度</b>與 PGA/PGV/PGD 尖峰值。（無記錄時可展開「正弦波震動」自訂方向/周期/最大位移生成合成波。）
                </li>
                <li>
                  <b>② 開始震動</b>：按主控台的「開始震動」執行，「停止」回到初始配置。時間顯示於按鈕上方。
                </li>
                <li>
                  <b>收合式設定</b>：<b>播放設定</b>（速度、起始時刻、振幅倍率、NS↔EW 交換）／<b>室內空間與家具</b>（切換和室・辦公室、勾選家具、以「▸ 質量/重心」調整參數）／<b>建物應答（進階）</b>。
                </li>
              </Section>
              <Section title="畫面與操作">
                <li><b>3D 視角</b>：拖曳旋轉、滾輪縮放。物理上房間固定、家具反應，視覺上整個房間依地動位移搖晃。</li>
                <li><b>波形面板</b>（右上「波形」）：加速度・速度・位移三分量波形與播放游標，可切換「全體 ⇄ ±15 秒窗」；縱軸固定為全記錄最大值。</li>
                <li><b>位移軌跡</b>（右上「軌跡 NS-EW」）：水平面內的位移軌跡（全軌跡淡色、近 2 秒橙、目前白點）。</li>
                <li><b>加速度 HUD</b>（上方）：近 1 秒最大合成加速度（gal）；提高振幅倍率時會標示「非真實比例」。</li>
                <li><b>家具狀態</b>（面板下方）：各家具的傾斜・移動量・傾倒判定、吊燈擺角。</li>
              </Section>
              <Section title="觀察提示">
                <li><b>弱震幾乎不動是正確的</b>：大型家具大致要到計測震度 5 弱（約 150〜250 gal）以上才傾倒；震度 1〜3 幾乎不動屬正常。</li>
                <li><b>高頻 vs 長周期</b>：同樣強度下，高頻記錄多半只搖、小物掉落；長周期或大速度脈衝才使大型家具傾倒。可比較不同記錄。</li>
                <li>背高且重心高的家具（書架・文件櫃）較易傾倒；附滾輪的影印機・辦公椅摩擦小、易滑動。</li>
                <li>提高「振幅倍率」可放大弱震以觀察（屬非真實比例）；改變質量・重心高，比較同一地震下的行為差異。</li>
              </Section>
            </TabsContent>
            <TabsContent value="faq" className="mt-0">
              <Section title="常見問題">
                <li><b>Q. 家具反應是怎麼驅動的？</b><br />A. 採「非慣性（地動）座標系」：房間固定，將地動加速度以偽力 −m·a 施加於每個家具（等同結構動力學的有效地震力 −m·a_g、D'Alembert 原理），視覺上房間依位移搖晃。此法讓家具直接感受真實的寬頻加速度，比「移動基座經接觸傳遞」在高頻更穩健。</li>
                <li><b>Q. 為何弱震（震度1〜3）家具幾乎不動？</b><br />A. 這是正確的物理。傾倒需水平加速度超過 g·(半底寬/重心高)、滑動需超過 μs·g；弱震遠低於此。大型家具大致要到震度 5 弱（約 150〜250 gal）以上才會傾倒。</li>
                <li><b>Q. 為何強震下大型家具只搖不倒、卻有小物掉落？</b><br />A. 傾倒取決於加速度<b>與頻率/速度</b>（Ishiyama 雙判據）。高頻晃動每次推力太短促，大型家具只來回搖擺；但花瓶・相框等傾倒門檻低的小物會被拋落。需長周期或大速度脈衝才會使大型家具真正傾倒。</li>
                <li><b>Q. 傾倒/滑動的臨界是多少？</b><br />A. 傾倒 a &gt; g·(半底寬/重心高)（Housner/Ishiyama）；滑動 a &gt; μs·g（庫倫，μs=1.3μk）。細高家具較易傾倒，低摩擦家具較易滑動。</li>
                <li><b>Q. 支援哪些波形格式？</b><br />A. miniSEED（SEED 2.x），依方位碼（Z/N/E）分離為 UD/NS/EW；支援 16/32-bit 整數、浮點、Steim-1/2 壓縮。以 10000 counts = 1 cm/s² 換算加速度（可於 mseed.ts 的 COUNTS_PER_GAL 依測站靈敏度調整）。</li>
                <li><b>Q. gal 與計測震度是什麼？</b><br />A. gal 為加速度單位，1 gal = 1 cm/s²（重力約 980 gal）。計測震度依氣象廳官方算法（頻域濾波→向量合成→0.3 秒判定，I=2·log₁₀a₀+0.94）計算，考量周期與持續時間，故與 gal 非一對一。</li>
                <li><b>Q. 「傾倒」「移動」如何判定？</b><br />A. 相對垂直軸傾斜 &gt; 45° 判傾倒；相對初始位置水平移動 &gt; 5cm 判移動（一旦判定即保持）。</li>
                <li><b>Q. 建物應答的參數？</b><br />A. 層高 4m・各層 1000t 等質量等剛性剪力型；S造 T₁=0.03H、RC造 T₁=0.02H 逆算剛度，Rayleigh 阻尼（S造2%／RC造3%），Newmark-β 法（β=1/4）。上層因共振使長周期成分放大。</li>
                <li><b>Q. 吊燈能擺多大？家具落地會跳動？</b><br />A. 吊燈為單擺，繩以剛性連結近似、天花板剛性（不穿越翻圈）。落地微小跳動為 240Hz 貫入補正的已知副作用，強烈上下動時可能殘留。</li>
                <li><b>Q. 動作卡頓／能否作防災判斷？</b><br />A. 卡頓可減少家具、關閉波形/軌跡面板、降低播放速度（物理固定 240Hz）。結果<b>不可</b>作防災對策判斷——本工具僅供體驗行為傾向，安全性判斷請依專業機構指引。</li>
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
