# Strong Motion Furniture Simulator / 強震動 家具挙動シミュレーター

## 🌐 Demo / デモ
Play the simulator in your browser:
**[Launch Simulator](https://<your-username>.github.io/<your-repository-name>/)**
*(Please replace the URL with your actual GitHub Pages URL)*

---

# 🇬🇧 English Section

## Overview
This is a web-based 3D physics simulator that visualizes the behavior of indoor furniture (overturning, sliding, and rocking) during earthquakes. By loading actual strong-motion seismogram CSV data, it drives a virtual shake table using [Three.js](https://threejs.org/) and [Cannon.js](https://schteppe.github.io/cannon.js/).

## Features
* **Real-time 3D Physics:** Simulates complex rigid-body dynamics of furniture under seismic excitation.
* **Customizable Furniture:** Various types of furniture (bookshelves, desks, beds, refrigerators, hanging lamps) with adjustable mass and center of gravity (CoG).
* **Interactive UI:** Control playback speed, amplitude scale, and start time dynamically. Waveform charts (NS, EW, UD) are synchronized with the simulation time.

## Supported Data and Formats
The simulator parses and processes the following CSV formats:
* **NIED K-NET / KiK-net Format:** Standard CSV files downloaded from the Kyoshin Network. The parser automatically detects sampling frequencies, duration, and extracts the 3-component surface acceleration data.
* **Japan Meteorological Agency (JMA) Strong Motion Format:** Shift-JIS encoded CSV files containing NS, EW, and UD components.

## Analysis Methods
### 1. Digital Signal Processing (DSP)
To prevent the baseline drift (low-frequency noise leading to displacement divergence) typical in strong-motion integration:
* **For K-NET/KiK-net:** Applies a 5th-order Butterworth High-Pass Filter (cutoff $f_p=0.1$ Hz, stopband $f_{stop}=0.05$ Hz) designed via bilinear transform, followed by cumulative trapezoidal integration to derive velocity and displacement. Mean offset removal is applied prior to filtering.
* **For JMA Data:** Implements the official JMA recursive integration formulas (Saito, 1978). Velocity is derived using a 3rd-order Butterworth equivalent integration (5-second cutoff), and displacement replicates a 1x strong-motion seismometer characteristic ($T_0=6$ s, $h=0.55$). Data is internally resampled to 100Hz if necessary.

### 2. Physics Modeling & Custom Stiction
Standard real-time rigid-body engines (like Cannon.js) struggle with static friction (stiction), causing objects to exhibit unrealistic "micro-creep" (sliding on ice) under minor forces. 
To resolve this, a custom **Stiction Algorithm** is implemented:
* Calculates the dynamic normal force using gravity and vertical seismic acceleration ($g + a_y$).
* Compares the required inertial force ($m \sqrt{a_x^2 + a_z^2}$) against the static friction limit ($\mu m (g + a_y)$).
* If the demand is below the friction limit and the object is not already sliding or rocking significantly, the object's velocity is kinematically locked to the shake table, ensuring physically accurate adherence to the floor.
* The physics step is stabilized at `dt = 1/240` seconds with 40 solver iterations to handle extreme seismic accelerations.

## Usage
1. Click **"CSVを読み込む" (Load CSV)** to import a waveform file.
2. Select furniture and adjust their mass/CoG settings.
3. Click **"室内に配置" (Place in Room)**.
4. Click **"加振開始" (Start Shake)** to run the simulation.

## Disclaimer
This simulator is for educational, enlightening, and visual demonstration purposes only. It employs approximated rigid-body physics in a browser environment. **Do not use this tool as a basis for structural design, seismic safety evaluation, or disaster prevention planning.** The author assumes no responsibility for any damages or losses resulting from the use of this software.

---

# 🇯🇵 Japanese Section

## 概要
本プログラムは、Webブラウザ上で動作する強震動シミュレーターです。実際の強震観測記録（CSVデータ）を読み込み、その波形データに基づいて仮想空間内の振動台を加振させることで、地震時における室内の家具（転倒、滑動、ロッキングなど）の挙動を3D物理演算により疑似的に再現します。

## 主な機能と特徴
* **3Dリアルタイム物理演算**: Three.js（描画）とCannon.js（剛体演算）を組み合わせ、地震波の3成分（NS, EW, UD）の入力を同時に受ける複雑な家具の挙動をリアルタイムにシミュレーションします。
* **多様な家具モデルとカスタマイズ**: 本棚、衣装棚、机、椅子、ベッド、冷蔵庫、天井からの吊り照明などを配置可能です。コントロールパネルから各家具の「質量」や「重心高（%）」を変更し、家具の挙動を比較・検証できます。
* **波形チャートの連動可視化**: 読み込んだデータの加速度・速度・変位グラフ（NS/EW/UDの3成分）を描画し、シミュレーションの進行時刻と連動したシークバーを表示します。
* **再生速度**: 再生速度（0.25倍〜2.0倍）の変更、振幅倍率の調整、無音区間を飛ばすための開始時刻（スキップ）設定が可能です。

## 読み込み可能なデータとフォーマット
以下の強震波形CSVファイルに対応しています。テキストのエンコーディング（UTF-8, Shift-JIS）は自動で判別されます。

1. **防災科学技術研究所（NIED） K-NET / KiK-net 形式**
   * ヘッダー行（`#`で始まる行）を自動解析し、サンプリング周波数、継続時間、観測点コード、地震の発生時刻・マグニチュード等を抽出します。
   * KiK-netの6成分データの場合、地表成分（ch4〜6）を自動的に抽出して使用します。
2. **気象庁（JMA）強震観測フォーマット**
   * NS, EW, UDの3成分がカンマ区切りで記録された標準的なCSV形式。ヘッダーからサンプリングレートを自動取得します。

## 解析方法（アルゴリズム詳細）

### 1. 波形処理・信号処理（DSP）
加速度波形から変位波形に変換する際、低周波ノイズによるベースライン・ドリフト（変位の発散）を防ぐため、データ形式に応じて処理を変えています。

* **K-NET / KiK-netデータに対する処理**:
  全波形の平均値を算出してオフセット（ゼロ点ずれ）を除去した後、斎藤(1978)の漸化式フィルタ設計に準拠した **5次 Butterworth ハイパスフィルター**（通過域 $f_p=0.1$ Hz, 阻止域 $f_{stop}=0.05$ Hz, $A_p=0.1$ dB, $A_s=10.0$ dB）を適用しています。加速度波形にHPFをかけた後、台形積分を用いて速度を算出し再度HPFを適用、さらに積分して変位を算出しHPFを適用するという手順を踏んでいます。
* **気象庁データに対する処理**:
  気象庁公式の**積分漸化式**を忠実に実装しています。速度波形は「カットオフ5秒の3次Butterworth積分特性（$G, A_1, A_2, A_3$係数）」、変位波形は「1倍強震計特性（固有周期 $T_0=6$ s, 減衰定数 $h=0.55$ に相当する $H, C_1, C_2, D_0, D_1, D_2$係数）」を用いて漸化式により算出されます。入力波形が100Hz以外の場合は、係数設計に合わせるため事前に100Hzへの線形リサンプリング処理が自動適用されます。

### 2. 物理モデリングと「静止摩擦（Stiction）」の独自実装
一般的なリアルタイム物理エンジン（Cannon.js等）の摩擦モデルは動摩擦の表現に特化しており、地震波のような微小な外力が加わる環境では、本来静止しているべき物体が氷の上を滑るように動いてしまう「微小クリープ現象」が避けられません。
本シミュレーターでは、この問題を解決するため独自の **静止摩擦（Stiction）アルゴリズム** を組み込んでいます。

* 毎フレーム、入力波形の上下動成分（$a_y$）による影響を加味した**法線方向実効重力（$g + a_y$）**を計算します。（突き上げによる摩擦力の低下を正確に評価します）。
* 水平方向の慣性力要求値（$m \sqrt{a_x^2 + a_z^2}$）と、クーロンの摩擦法則に基づく静止摩擦限界（$\mu m (g + a_y)$）を比較します。
* 慣性力が静止摩擦限界を下回っており、かつ家具がすでに滑走またはロッキング（スピン）状態にない場合、物理エンジンの動摩擦計算をオーバーライドし、家具の水平方向の速度を振動台（床面）の速度に強制的に固着させます。

### 3. 剛体演算の安定化手法
強震動における急激な加速度変化（数千galクラス）による衝突判定の破綻（突き抜け現象）を防ぐため、物理演算のタイムステップを `dt = 1/240` 秒に細分化し、ソルバーの反復回数（Iterations）を `40` に設定することで、ブラウザ上での計算負荷と物理的精度の最適なバランスを取っています。また、家具の重心オフセット（`cogY`）を設定することで、現実の家具に近い転倒モーメントを再現しています。

## 使い方
1. **波形ファイルの用意**: NIEDまたは気象庁の強震記録CSVファイルを手元に用意します。
2. **読み込み**: 画面左側のパネル「CSVを読み込む」ボタンからファイルを選択します。（読み込みが成功するとPGA, PGV, PGD等のピーク値が表示されます）。
3. **家具の設定**: リストからシミュレーションしたい家具にチェックを入れます。「質量（kg）」や「重心高（%）」の数値を任意に変更可能です。
4. **配置**: 「室内に配置（リセット）」ボタンを押すと、初期状態として3D空間に家具がセットされます。
5. **加振**: 「加振開始」ボタンでシミュレーションがスタートします。再生速度や振幅倍率を操作しながら挙動を観察してください。右上の「波形 表示/非表示」ボタンでチャートの出し入れが可能です。

## 免責事項
本シミュレーターは、ブラウザ環境における剛体物理エンジンを用いた疑似的な挙動解析ツールです。防災教育、啓発、および強震波形データの視覚的な直感の補助を目的として作成されています。
**本プログラムの計算結果を、実際の建築物や家具の耐震設計、安全性評価、または防災計画・被害想定の根拠として直接使用することは固く禁じます。** 現実の挙動は、床材の微小な不均一性、建物の共振特性、家具の内容物の移動など、無数の要因によって変化します。本プログラムの使用によって生じたいかなる損害・不利益についても、作者は一切の責任を負いかねます。

## ライセンス (License)
MIT License
