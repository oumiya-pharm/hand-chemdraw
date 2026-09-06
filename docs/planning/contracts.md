# 実装境界とデータ契約

これは反応・配列まで拡張する際の設計用契約であり、以下のファイルや関数が現在存在するという意味ではない。2026-09-06の初版は、ユーザーの実装開始指示を受け、分子編集に必要な小さい契約を [src/core/types.ts](../../src/core/types.ts) に実装した。現在の実装を変更する際はそのTypeScript型を正本とし、この拡張設計と混同しない。外部ライブラリの型をUIへ露出させない。

## 1. ファイル配置

```text
src/
  app/                 起動、文書の切替、上部操作
  document/            文書モデル、編集操作、履歴、revision
  canvas/              Pointer Events、鉛筆、消しゴム、ビューポート
  rendering/           文書からSVG描画モデル、当たり判定
  recognition/         筆跡のまとまり、幾何、記号、候補選択
  chemistry/           Indigo接続、化学検証、MOL/KETとの境界
  storage/             IndexedDB、ネイティブ保存、移行、競合
  export/              形式レジストリ、検証、形式別エンコーダー
  reactions/           反応の役割、矢印、条件
  sequences/           モノマー、結合位置、配列
  scene3d/             3D座標と印刷用メッシュ
  workers/             化学・認識の実行入口
tests/
  fixtures/            原子的な既知構造、筆跡、期待される操作
  unit/                純粋関数と履歴
  browser/             Worker、Canvas、保存、オフライン
  interoperability/    形式往復、他実装による確認
tools/
  evaluation/          筆跡の再生と評価集計
  training/            条件を満たさない場合のローカル学習
public/
  chemistry/           固定版WASMと必要な静的データ
  recognition/         テンプレート、任意の小型ONNXモデル
docs/evidence/         実測値、バージョン、形式別検証記録
```

P01で必要なものから作成する。中身がないディレクトリや空の実装ファイルを先に大量作成しない。

## 2. 文書モデル (`src/document/types.ts`)

```ts
export type Id = string;
export type Point = Readonly<{ x: number; y: number }>;
export type InkPoint = Point & Readonly<{ t: number; pressure?: number }>;
export type Tool = 'pencil' | 'eraser';
export type Stroke = Readonly<{
  id: Id; points: readonly InkPoint[];
  device: 'mouse' | 'pen' | 'touch' | 'unknown';
  state: 'raw' | 'pending' | 'committed';
  sourceStrokeIds: readonly Id[];
}>;
export type Atom = Readonly<{
  id: Id; element: string; position: Point;
  charge: number; isotope: number | null;
  explicitHydrogens: number | null;
  alias: string | null;
}>;
export type Bond = Readonly<{
  id: Id; from: Id; to: Id; order: 1 | 2 | 3;
  stereo: 'none' | 'up' | 'down' | 'either';
}>;
export type Graph = Readonly<{
  atoms: readonly Atom[]; bonds: readonly Bond[];
}>;
export type MoleculeRecord = Readonly<{
  id: Id; graph: Graph; properties: Readonly<Record<string, string>>;
}>;
export type Annotation = Readonly<{
  id: Id; kind: 'text' | 'arrow' | 'bracket';
  points: readonly Point[]; text: string;
}>;
export type Reaction = Readonly<{
  id: Id; reactants: readonly Id[]; products: readonly Id[];
  agents: readonly Id[]; arrowId: Id; conditionAnnotationIds: readonly Id[];
  atomMapping: Readonly<Record<Id, number>>;
}>;
export type StructuralGroup = Readonly<{
  id: Id; kind: 'abbreviation' | 'superatom' | 'repeat' | 'query';
  atomIds: readonly Id[]; bondIds: readonly Id[];
  label: string; expansion: Graph | null;
  attachmentAtomIds: readonly Id[];
}>;
export type StereoGroup = Readonly<{
  id: Id; kind: 'absolute' | 'and' | 'or'; atomIds: readonly Id[];
}>;
export type MonomerDefinition = Readonly<{
  id: Id; family: 'peptide' | 'dna' | 'rna' | 'chemical';
  naturalAnalog: string | null; structure: Graph;
  attachmentAtoms: Readonly<Record<string, Id>>;
}>;
export type SequenceRecord = Readonly<{
  id: Id;
  monomers: readonly Readonly<{ id: Id; definitionId: Id }>[];
  links: readonly Readonly<{
    from: Id; fromAttachment: string; to: Id; toAttachment: string;
  }>[];
  cyclic: boolean;
}>;
export type Scene3D = Readonly<{
  id: Id; moleculeId: Id;
  coordinates: Readonly<Record<Id, readonly [number, number, number]>>;
  provenance: 'imported' | 'calculated' | 'planar-display';
}>;
export type Document = Readonly<{
  schemaVersion: 1; id: Id; revision: number;
  molecules: readonly MoleculeRecord[]; ink: readonly Stroke[];
  annotations: readonly Annotation[]; reactions: readonly Reaction[];
  groups: readonly StructuralGroup[]; stereoGroups: readonly StereoGroup[];
  monomerDefinitions: readonly MonomerDefinition[];
  sequences: readonly SequenceRecord[]; scenes3d: readonly Scene3D[];
}>;
export type Issue = Readonly<{
  code: string; severity: 'warning' | 'error';
  targetIds: readonly Id[]; message: string;
}>;
```

`explicitHydrogens: null` は化学エンジンに暗黙水素を計算させる意味。0と混同しない。`alias` は表示文字列であり、構造を持つ略記は `StructuralGroup.expansion` と接続原子を必須にする。表示上のくさびと絶対配置は同一概念ではなく、エンジンへの境界で隣接順序・座標・StereoGroupと合わせて扱う。

初期スキーマには将来の要素の配列も含めるが、対応作業が完了するまでUIから作成しない。未知スキーマは明示的エラーとし、無視して保存し直さない。将来の追加項目は移行関数を伴うschemaVersion変更で導入する。

## 3. 編集と履歴 (`src/document/commands.ts`, `history.ts`)

```ts
export type EditProposal = Readonly<{
  id: Id; documentId: Id; baseRevision: number;
  targetIds: readonly Id[]; sourceStrokeIds: readonly Id[];
  kind: 'draw' | 'replace-atom' | 'change-bond' | 'erase' | 'move' | 'import';
  after: Document; issues: readonly Issue[];
}>;
export type Transaction = Readonly<{
  id: Id; before: Document; after: Document;
  targetIds: readonly Id[]; sourceStrokeIds: readonly Id[];
}>;
export type HistoryState = Readonly<{
  present: Document; past: readonly Transaction[]; future: readonly Transaction[];
}>;
export function createDocument(id: Id): Document;
export function createHistory(document: Document): HistoryState;
export function commitEdit(history: HistoryState, edit: EditProposal): HistoryState;
export function undoHistory(history: HistoryState): HistoryState;
export function redoHistory(history: HistoryState): HistoryState;
export function reviseLastEdit(history: HistoryState, transactionId: Id,
  edit: EditProposal): HistoryState;
export function replaceAtom(document: Document, atomId: Id,
  element: string): EditProposal;
export function setBondOrder(document: Document, bondId: Id,
  order: 1 | 2 | 3): EditProposal;
export function deleteBond(document: Document, bondId: Id): EditProposal;
export function validateDocument(document: Document): readonly Issue[];
```

これらは計画用のTypeScript宣言。実装時は必要なtype importと関数本体を追加する。

revisionはUndoでもRedoでも単調増加させる。履歴の内容は過去へ戻っても現在のrevisionを過去値へ戻さない。`commitEdit` は文書IDとbaseRevisionが合わなければ `StaleEditError` を投げ、現状態を変えない。`reviseLastEdit` は履歴の末尾IDが一致し、対象への競合が無い場合だけ許可する。後続操作のある任意の過去をこっそり再解釈しない。

ランタイムの履歴はイミュータブルな構造共有を使う。永続化はチェックポイントと編集差分へ圧縮し、フルスナップショットを毎回IndexedDBへ複写しない。Undo最低100操作を受入対象とし、上限による切捨ては保存済みチェックポイント以降で行う。

## 4. 描画・消去 (`src/rendering/types.ts`, `src/canvas/erase.ts`)

```ts
export type RenderLine = Readonly<{
  id: Id; ownerId: Id; ownerKind: 'bond' | 'annotation';
  role: 'single' | 'multiple-0' | 'multiple-1' | 'multiple-2' | 'stereo';
  from: Point; to: Point;
}>;
export type RenderLabel = Readonly<{
  id: Id; ownerId: Id; text: string;
  position: Point; bounds: readonly [number, number, number, number];
}>;
export type RenderModel = Readonly<{
  documentId: Id; revision: number;
  lines: readonly RenderLine[]; labels: readonly RenderLabel[];
}>;
export function buildRenderModel(document: Document): RenderModel;
export function serializeSvg(model: RenderModel): string;
export function eraseStroke(stroke: Stroke, path: readonly Point[],
  radius: number): readonly Stroke[];
export function planErase(document: Document, startModel: RenderModel,
  path: readonly Point[], radius: number): EditProposal;
```

`RenderModel` に未確定筆跡は入れない。インクは別レイヤーで同じ座標系に描く。SVG出力ではこのモデルを共通利用し、画面のスクリーンショットから構造式画像を作らない。原子ラベルの文字単位の当たり判定とベジェ図形はP12/P17でこの契約を明示的に拡張する。

消去の開始時モデルを固定することで、2→1の再描画後に消しゴムが残りの線を再び消す連鎖を防ぐ。実行中の消去マスクを構造描画へ重ね、消している箇所が見えるようにする。

## 5. 認識 (`src/recognition/types.ts`)

```ts
export type RecognitionContext = Readonly<{
  document: Document; nearbyAtomIds: readonly Id[];
  nearbyBondIds: readonly Id[]; bondLength: number;
}>;
export type SymbolCandidate = Readonly<{
  token: string; distance: number; sourceStrokeIds: readonly Id[];
}>;
export type Candidate = Readonly<{
  edit: EditProposal; score: number; evidence: readonly string[];
}>;
export type Decision =
  | Readonly<{ kind: 'commit'; candidate: Candidate }>
  | Readonly<{ kind: 'pending'; candidates: readonly Candidate[] }>;
export type Thresholds = Readonly<{
  minScore: number; minMargin: number;
}>;
export function recognizeGeometry(strokes: readonly Stroke[],
  context: RecognitionContext): readonly Candidate[];
export function recognizeSymbols(strokes: readonly Stroke[]): readonly SymbolCandidate[];
export function interpretSymbols(symbols: readonly SymbolCandidate[],
  context: RecognitionContext): readonly Candidate[];
export function decide(candidates: readonly Candidate[], thresholds: Thresholds): Decision;
export interface SymbolClassifier {
  classify(strokes: readonly Stroke[]): Promise<readonly SymbolCandidate[]>;
  dispose(): void;
}
export type RecognitionRequest = Readonly<{
  requestId: Id; documentId: Id; baseRevision: number;
  strokes: readonly Stroke[]; context: RecognitionContext;
}>;
export type RecognitionReply = Readonly<{
  requestId: Id; documentId: Id; baseRevision: number;
  candidates: readonly Candidate[];
}>;
```

`score` は校正前には確率ではない。幾何、記号距離、接続文脈、候補間隔のログを保存し、P10で閾値を固定する。未知の記号も必ず最も近い元素へ割り当てることはしない。

## 6. 化学エンジンと出力 (`src/chemistry/types.ts`, `src/export/types.ts`)

```ts
export type EngineFormat = 'molfile' | 'sdf' | 'smiles' | 'inchi' | 'inchi-key'
  | 'ket' | 'cdxml' | 'cdx' | 'rxnfile' | 'rdf' | 'helm' | 'fasta';
export type EngineInput = Readonly<{
  text: string; format: EngineFormat;
}>;
export type EngineResult = Readonly<{
  payload: string; encoding: 'text' | 'base64'; format: EngineFormat;
}>;
export type ChemicalInspection = Readonly<{
  issues: readonly Issue[]; aromaticAtomIds: readonly Id[];
  aromaticBondIds: readonly Id[]; hydrogenCounts: Readonly<Record<Id, number>>;
}>;
export interface ChemicalEngine {
  initialize(): Promise<Readonly<{ version: string }>>;
  inspect(molecule: MoleculeRecord): Promise<ChemicalInspection>;
  convert(input: EngineInput, output: EngineFormat,
    options?: Readonly<Record<string, string>>): Promise<EngineResult>;
  dispose(): void;
}
export type ExportFormat = 'native' | 'smiles' | 'mol-v2000' | 'mol-v3000'
  | 'sdf-v2000' | 'sdf-v3000' | 'cdxml' | 'cdx' | 'inchi' | 'inchi-key'
  | 'svg' | 'png' | 'jpeg' | 'gif' | 'bmp' | 'tiff' | 'eps' | 'pdf'
  | 'rxn-v2000' | 'rxn-v3000' | 'rdf-v2000' | 'rdf-v3000'
  | 'helm' | 'fasta-peptide' | 'fasta-dna' | 'fasta-rna'
  | 'skc' | 'sln' | '3mf' | 'pptx';
export type ExportRequest = Readonly<{
  format: ExportFormat; recordIds: readonly Id[];
  scope: 'document' | 'records' | 'reaction' | 'sequence' | 'scene3d';
  allowLosses: readonly string[];
}>;
export type ExportInspection = Readonly<{
  canExport: boolean; issues: readonly Issue[];
  losses: readonly Readonly<{ code: string; targetIds: readonly Id[]; message: string }>[];
}>;
export type ExportArtifact = Readonly<{
  bytes: Uint8Array; mime: string; filename: string;
  inspection: ExportInspection;
}>;
export interface Exporter {
  inspect(document: Document, request: ExportRequest): ExportInspection;
  write(document: Document, request: ExportRequest): Promise<ExportArtifact>;
}
```

`ChemicalEngine` の全機能を既成WASMがすでに公開しているとは仮定しない。P03で実証し、必要なら変換結果のMOL/KETから派生情報を計算するAdapterを作る。WASMオブジェクトの破棄とWorker再起動はAdapterの責務。PNGなどの図版は化学エンジンの描画へ委譲せず、文書レイアウト由来の共通描画を使う。

`recordIds` は塩を含む分子レコード、反応、配列、シーンのIDをscopeに応じて指定する。何も選択せず複数レコードを単一分子形式に渡した場合に、最初の一つだけを出力しない。

V2000の制約に達した場合はV3000への切替を提案する。選んだV2000という拡張子のまま無言でV3000を出さない。立体化学や反応情報が対象形式に入らない場合、`allowLosses` に含まれる損失だけを許可する。

## 7. 共通fixture (`tests/fixtures/builders.ts`)

P02で実装する。下記の関数は後続の計画中の試験コードから参照する。

```ts
export function benzeneDocument(): Document;
export function pyridineDocument(): Document;
export function cyclohexaneDocument(): Document;
export function acetateSaltDocument(): Document;
export function stereochemistryDocument(): Document;
export function basicReactionDocument(): Document;
export function peptideDocument(): Document;
export function sequenceDocument(family: 'dna' | 'rna'): Document;
export function lineStroke(points: readonly Point[], id?: Id): Stroke;
```

benzeneの原子IDはa0–a5、結合IDはb0–b5、レコードIDはm0、文書IDはdoc0、revisionは0。aiの座標は `(100 + 40 cos(iπ/3), 100 + 40 sin(iπ/3))`。biはai→a((i+1)%6)、偶数iで二重結合、奇数iで単結合。pyridineはa0だけN、cyclohexaneは全結合1。残りの空配列を省略しない。

acetateSaltは単一レコード内に酢酸イオンとNa+の二成分。stereochemistryはR/Sを区別する一対とE/Zを区別する一対を独立レコードとして持ち、期待識別子はP12で外部エンジンと照合してfixtureに固定する。basicReactionはエタノール→アセトアルデヒド、反応矢印と条件注釈を持つ。peptideはGly-Ala、DNAはACGT、RNAはACGU。単なるテキストから推測して配列以外の分子をFASTAにしない。
