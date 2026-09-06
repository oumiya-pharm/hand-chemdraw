# Hand Chemistry Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded implementation and review tasks; keep shared-interface changes with the controller. Steps use checkbox syntax for tracking.

**Goal:** 紙・鉛筆・消しゴムの操作で手書きから化学構造を継続編集し、端末内で保存・出力する。

**Architecture:** SVGで構造と筆跡を重ね、文書グラフを正本にする。幾何と局所的な記号認識が編集差分を生成し、消しゴムは各描画線を直接対象にする。Indigo WASMをWorkerに置き、分子の検証と形式変換を担当させる。

**Tech Stack:** TypeScript / React / Vite / SVG / Indigo WASM / Vitest / Playwright。

**Spec:** [設計仕様](../specs/2026-09-05-hand-chemistry-design.md)。実装開始の指示: 2026-09-05「実装して」。

## Global Constraints

- 実行時の認識・化学処理・保存・出力はブラウザ内だけで完結する。
- 構造式・筆跡・認識結果を外部へ送信しない。クラウド推論へのフォールバックを設けない。
- 必須操作はマウス／トラックパッドのドラッグで成立する。筆圧、ペン種別、WebGPUを必須条件にしない。
- 原子ID・結合ID・筆跡との対応を編集の途中で付け替えない。
- 描画だけで無関係な原子の座標・結合・立体化学を変更しない。

## 実行方針

ユーザーは計画作成中に実装開始を指示した。まず下記Task 1–6を連続実装して実ブラウザで動かす。出力形式を架空の対応として表示しない。実機・データが必要な評価や旧形式は受入未達として記録する。

| Task | 成果物 | 依存 | 合格基準 |
|---|---|---|---|
| 1 | 文書・筆跡・履歴、幾何認識、描画線 | なし | 六角形の方向や開始点に依存しない。接続先・IDを保持 |
| 2 | 化学Worker・検証・形式変換 | Task 1の型 | 実WASMでSMILES/MOL/SDF/CDX/CDXML/InChIを生成し再読込 |
| 3 | 鉛筆・消しゴム・紙面UI | Task 1 | 描画、Nの追記、片線消去、Undoが実マウス入力で動く |
| 4 | 保存・読込・オフライン | Task 1–3 | 再起動後も構造・筆跡・配置を復元。外部送信なし |
| 5 | 出力UI・画像・互換性情報 | Task 2–4 | 選んだ形式の正しいバイト列をダウンロード。失敗を隠さない |
| 6 | ブラウザ試験・レビュー・修正 | Task 1–5 | 操作の一巡、再読込、ネットワーク切断、ビルド成功 |

### Task 1: 編集コアと認識

Files: `src/core/types.ts`, `src/core/geometry.ts`, `src/core/recognition.ts`, `src/core/editor.ts`, `src/core/render.ts`, `src/core/core.test.ts`。

- [x] 六角形、頂点へのN、線の追加、消去、履歴について期待グラフを手で決めた試験を作る。
- [x] `npm test -- src/core/core.test.ts` で未実装の失敗を確認する。
- [x] 初期文書は原子・結合・筆跡・タイトル・保存形式バージョンを持つ。将来の反応・配列用の空機能は先に実装しない。詳細設計のデータ境界は維持し、実装の現行契約は `src/core/types.ts` とする。
- [x] 六角形は折れ点抽出と辺長のばらつきから判定し、描いた中心・回転・大きさを保つ。線分は端点近傍の原子に接続する。
- [x] 消去は開始時の描画線に固定。片線なら次数を下げ、すべてなら結合を削除する。
- [x] 試験を通し、化学WorkerとUIへインターフェースを渡す。

```ts
// 試験で保護する意味: 内側線の消去が環の削除にならない。
expect(result.atoms).toHaveLength(6);
expect(result.bonds).toHaveLength(6);
expect(result.bonds.filter(b => b.order === 2)).toHaveLength(2);
```

### Task 2: 実WASMによる化学処理

Files: `src/chemistry/*`, `src/workers/chemistry.worker.ts`, `tests/chemistry.test.ts`。Task 1から `Sketch`, `Atom`, `Bond` を消費する。

- [x] nodeまたはブラウザでインストール済みIndigoの実APIと配布ファイルを確認する。
- [x] 手で検証したベンゼンとピリジンのグラフをMOLに変換する境界試験を先に書く。
- [x] requestIdによる照合、初期化失敗、タイムアウト、WASMオブジェクト解放を含むWorkerを作る。
- [x] 出力は少なくともSMILES/MOL V2000・V3000/SDF/CDX/CDXML/InChI/InChIKey。反応・配列形式は対応する文書があるときだけ提供する。
- [x] `indigo.convert(input, format, options)` を実際に呼び、バイナリ出力のencodingを確認する。
- [x] 構造へ戻せる10形式の変換を再読込し、構造・芳香族性・電荷を確認する。InChIKeyは出力専用として検証する。

### Task 3: 紙・鉛筆・消しゴム

Files: `src/App.tsx`, `src/components/SketchCanvas.tsx`, `src/styles.css`。

- [x] 空白の紙、鉛筆・消しゴム、文書名、Undo/Redo、出力というレイアウトを作る。
- [x] Pointer captureとSVG座標変換を使い、ドラッグで連続点を取得する。
- [x] 手書きの確定前は原筆跡を表示し、変換時は触った領域だけを更新する。
- [x] Nの途中の筆跡を後続筆跡で局所的に再解釈できるよう、直前の入力前スナップショットを保持する。
- [x] 消しゴムの円と消去中の見た目を出し、Eの一時切替・Undo/Redo・Space移動を実装する。
- [x] ブラウザで六角形→N→消去→追記→Undoを操作する。

### Task 4: 永続化とネットワーク切断

Files: `src/storage.ts`, `vite.config.ts`（ビルド時に `dist/sw.js` を生成）, `src/main.tsx`, `src/storage.test.ts`。

- [x] 壊れたJSON、未知バージョン、参照先のない結合を拒否する試験を書く。
- [x] 自動保存とネイティブJSON保存・読込を実装する。保存失敗は見える状態にする。
- [x] 静的アセットとWASMを同一オリジンに配置し、Service Workerで配信済みバージョンを保持する。
- [x] オフライン再起動後に編集と出力を実行する。CDNや分析APIへの依存がないことをネットワーク記録で確認する。

### Task 5: 出力と互換性表示

Files: `src/components/ExportDialog.tsx`, `src/core/render.ts`, `docs/planning/format-compatibility.md`。

- [x] 出力形式レジストリと未確定筆跡の扱いを実装する。
- [x] SVGは描画モデルから生成する。PNG/JPEGはそのSVGをブラウザCanvasで変換する。
- [x] CDXのバイナリ、MOLの版、SDFの終端、SMILESの立体・電荷を試験する。
- [x] 使用可能な形式だけを有効にし、ChemDraw全出力の差分を対応表に残す。
- [x] 各形式の出力をダウンロードして実データを確認する。

### Task 6: 統合受入

Files: `tests/browser.spec.ts`, `playwright.config.ts`, `docs/evidence/implementation-status.md`, `README.md`。

- [x] 実マウスイベントで六角形を描き、環の頂点にNを書く試験を作る。
- [x] 消しゴムで二重結合の片線を消して、環が切れないことを確認する。
- [x] Undo/Redo、保存復元、オフライン、出力の試験を実行する。
- [x] `npm test`、`npm run build`、`npm run test:browser` を実行する。
- [x] 画面を撮って実際に見て、切れた文字・覆われた操作・座標ずれを修正する。
- [x] コードレビューを行い、重要な不具合を修正する。
- [x] 実装済み・実測済み・外部評価待ちを区別して記録し、起動URLのCodexブラウザ表示を要求する（queued）。

## 初版の検証記録

2026-09-06の実装と実行結果は [実装状況](../../evidence/implementation-status.md) に記録する。以下の拡張は初版の完了に含めず、元の要求として維持する。

## その後の拡張とゲート

詳細な要求は設計仕様と評価仕様に残す。反応式・配列・旧形式・3MFはTask 2の化学AdapterとTask 5の形式レジストリから拡張する。主要形式の出力ができても、全形式互換とは呼ばない。

テンプレートの個人差は筆者を分離したデータで評価し、不合格なら小型ONNX分類器を比較する。既成モデルの導入自体を成果にせず、誤確定・保留率・速度で採否を決める。
