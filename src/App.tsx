import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Eraser, MousePointer2, SquareDashed, Undo2, Redo2, Upload, ArrowUpRight, Download, Plus, HelpCircle, Grid2X2, Check, ShieldCheck, X, Copy, LoaderCircle, Minus, FileText } from 'lucide-react';
import SketchCanvas, {type CanvasHandle} from './components/SketchCanvas';
import ExportDialog from './components/ExportDialog';
import { emptySketch, type Sketch, type Tool } from './core/types';
import { loadSketch, saveSketch, parseSketch, download, STORAGE_KEY } from './storage';
import { chemistry } from './chemistry/client';
import { repairValence } from './core/valence';
import { useChemicalNormalization } from './useChemicalNormalization';
import { recognize } from './core/editor';
import {BOND_KINDS,type BondKind} from './core/bondEditing';
import {chargedElementLabel} from './core/directEditing';
import BondGlyph from './components/BondGlyph';

function convertSavedInk(sketch:Sketch):Sketch {
  let result:Sketch={...sketch,ink:[]};
  for(const stroke of sketch.ink)result=recognize(result,[stroke]).sketch;
  return result;
}

export default function App() {
  const [initial]=useState(loadSketch),[history,setHistory]=useState<{past:Sketch[];present:Sketch;future:Sketch[]}>({past:[],present:initial.sketch,future:[]});
  const sketch=history.present;
  const sketchRef=useRef(sketch);sketchRef.current=sketch;
  const [tool,setTool]=useState<Tool>('pencil'),[eraserSize,setEraserSize]=useState(4),[grid,setGrid]=useState(false),[resetKey,setResetKey]=useState(0),[selected,setSelected]=useState<string|null>(null);
  const [paintElement,setPaintElement]=useState<string|null>(null);
  const [paintCharge,setPaintCharge]=useState(0),[paintBondKind,setPaintBondKind]=useState<BondKind|null>(null);
  const [exportOpen,setExportOpen]=useState(false),[help,setHelp]=useState(false),[newOpen,setNewOpen]=useState(false),[importOpen,setImportOpen]=useState(false),[importText,setImportText]=useState('');
  const [notice,setNotice]=useState(initial.error??''),[saveState,setSaveState]=useState('この端末に保存'),[saveBlocked,setSaveBlocked]=useState(!!initial.error);
  const [analysis,setAnalysis]=useState<{smiles:string;formula:string;mass:string;issues:string[]}|null>(null),[analyzing,setAnalyzing]=useState(false),[importing,setImporting]=useState(false);
  const file=useRef<HTMLInputElement>(null),noticeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const canvas=useRef<CanvasHandle>(null);
  const status=useCallback((text:string)=>{setNotice(text);if(noticeTimer.current)clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setNotice(''),4200);},[]);
  const change=useCallback((next:Sketch,merge=false)=>{
    const previous=sketchRef.current,corrected=repairValence(previous,next);
    if(corrected.messages.length)status(corrected.messages.join(' '));
    if(JSON.stringify(previous)===JSON.stringify(corrected.sketch))return previous;
    sketchRef.current=corrected.sketch;
    setHistory(h=>({past:merge&&h.past.length?h.past:[...h.past,h.present].slice(-100),present:corrected.sketch,future:[]}));
    return corrected.sketch;
  },[status]);
  const isBusy=useCallback(()=>canvas.current?.isBusy()??false,[]);
  const applyLayout=useCallback((before:Sketch,after:Sketch)=>{
    if(sketchRef.current!==before)return null;
    const accepted=canvas.current?.acceptLayout(before,after)??null;if(!accepted)return null;
    sketchRef.current=accepted;
    // Coordinate cleanup belongs to the existing edit, including a restored Undo
    // snapshot. It must never discard Redo or add a separate history step.
    setHistory(h=>h.present===before?{...h,present:accepted}:h);
    return accepted;
  },[]);
  const formatting=useChemicalNormalization(sketch,isBusy,applyLayout,status);
  const recoveredInitial=useRef(false);
  useEffect(()=>{
    if(recoveredInitial.current)return;recoveredInitial.current=true;
    // Migrate old raw strokes through the same graph conversion as new input.
    // The original note remains recoverable as one Undo step.
    change(convertSavedInk(sketchRef.current));
  },[change]);
  const resetInput=useCallback(()=>{canvas.current?.flush();setResetKey(k=>k+1);setSelected(null);},[]);
  const undo=useCallback(()=>{resetInput();setHistory(h=>h.past.length?{past:h.past.slice(0,-1),present:h.past.at(-1)!,future:[h.present,...h.future]}:h);},[resetInput]);
  const redo=useCallback(()=>{resetInput();setHistory(h=>h.future.length?{past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1)}:h);},[resetInput]);
  const saveNote=useCallback(()=>{const latest=canvas.current?.flush()??sketch;download(JSON.stringify(latest,null,2),`${latest.title||'note'}.te.json`,'application/json');status('ノートを保存しました');},[sketch,status]);
  useEffect(()=>{
    if(saveBlocked){setSaveState('自動保存を停止中');return;}
    try{saveSketch(sketch);setSaveState('この端末に保存済み');}catch{setSaveState('保存できませんでした');status('保存容量が不足しています。「ノートを保存」でファイルに残してください。');}
  },[sketch,saveBlocked,status]);
  useEffect(()=>{
    const listener=(e:StorageEvent)=>{if(e.key===STORAGE_KEY){setSaveBlocked(true);status('別のタブでノートが更新されました。競合を防ぐため自動保存を停止しました。');}};
    window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);
  },[status]);
  useEffect(()=>{
    if(!sketch.atoms.length){setAnalysis(null);setAnalyzing(false);return;}
    let current=true;setAnalyzing(true);
    const timer=setTimeout(()=>{chemistry.analyze(sketch).then(value=>{if(current)setAnalysis(value);}).catch(e=>{if(current)setAnalysis({smiles:'',formula:'',mass:'',issues:[e.message]});}).finally(()=>{if(current)setAnalyzing(false);});},320);
    return()=>{current=false;clearTimeout(timer);};
  },[sketch]);
  useEffect(()=>{
    const listener=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement).matches('input,textarea,select')||document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'))return;
      if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){e.preventDefault();e.shiftKey?redo():undo();}
      if((e.ctrlKey||e.metaKey)&&e.code==='KeyY'){e.preventDefault();redo();}
      if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.code==='KeyP'||e.code==='KeyV')){resetInput();setTool(e.code==='KeyP'?'pencil':'select');if(e.code==='KeyP'){setPaintElement(null);setPaintBondKind(null);setPaintCharge(0);}}
      if((e.ctrlKey||e.metaKey)&&e.code==='KeyS'){e.preventDefault();saveNote();}
    };window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);
  },[undo,redo,resetInput,saveNote]);
  async function importData(data:string|Uint8Array,name?:string){
    setImporting(true);resetInput();
    try{let next:Sketch;
      if(typeof data==='string'&&(/\.te\.json$/i.test(name??'')||data.trimStart().startsWith('{')&&data.includes('"version"')))next=parseSketch(data);
      else next=await chemistry.parse(data);
      if(name)next.title=name.replace(/\.(te\.json|[^.]+)$/,'');change(convertSavedInk(next));setImportOpen(false);setImportText('');status('構造式を開きました');
    }catch(e){status(e instanceof Error?e.message:'ファイルを開けませんでした。');}finally{setImporting(false);}
  }
  async function openFile(event:React.ChangeEvent<HTMLInputElement>){const f=event.target.files?.[0];event.target.value='';if(!f)return;if(f.size>10_000_000){status('10MB以下のファイルを選んでください。');return;}await importData(/\.cdx$/i.test(f.name)?new Uint8Array(await f.arrayBuffer()):await f.text(),f.name);}
  function chooseElement(element:string|null,charge=0){resetInput();setTool('pencil');setPaintElement(element);setPaintCharge(charge);setPaintBondKind(null);}
  function chooseBond(kind:BondKind|null){resetInput();setTool('pencil');setPaintElement(null);setPaintCharge(0);setPaintBondKind(kind);}
  const atomMode=tool==='pencil'&&paintElement!==null;
  const ionLabel=paintElement?chargedElementLabel(paintElement,paintCharge):'';
  const selectedAtom=sketch.atoms.find(a=>a.id===selected);
  const unspecifiedStereo=!!analysis?.issues.length&&analysis.issues.every(issue=>/undefined stereo configuration/i.test(issue));
  const moleculeCount=sketch.atoms.length?`${sketch.atoms.length} 原子`:'まだ何も描いていません';
  return <div className="app-shell" data-formatting={formatting}>
    <header className="app-header"><div className="brand"><span className="brand-mark">te<span>.</span></span><span className="brand-description">手書きの化学ノート</span></div>
      <div className="document-title"><input aria-label="ノートの名前" value={sketch.title} onFocus={resetInput} onChange={e=>{const title=e.target.value;setHistory(h=>({...h,present:{...h.present,title}}));}} maxLength={80}/><span><Check size={11}/>{saveState}</span></div>
      <div className="header-actions"><button className="text-button" onClick={()=>{resetInput();setImportOpen(true);}}><Upload size={15}/> 開く</button><button className="primary-button" onClick={()=>{resetInput();setExportOpen(true);}}><span>書き出す</span><ArrowUpRight size={17}/></button></div>
    </header>
    <main className="workspace">
      <div className="bond-palette" role="toolbar" aria-label="結合の種類">
        <span className="palette-label">結合</span>
        <button className={tool==='pencil'&&!paintElement&&!paintBondKind?'selected':''} aria-label="結合を描く" title="手書きから環や結合を自動認識 (P)" aria-pressed={tool==='pencil'&&!paintElement&&!paintBondKind} onClick={()=>chooseBond(null)}><Pencil size={15}/><span>自動</span></button>
        {BOND_KINDS.map(({kind,label})=><button key={kind} className={tool==='pencil'&&paintBondKind===kind?'selected':''} aria-label={label} title={`${label}：描くか、既存の結合をなぞって変更`} aria-pressed={tool==='pencil'&&paintBondKind===kind} onClick={()=>chooseBond(kind)}><svg viewBox="0 0 34 20" width="34" height="20" aria-hidden="true"><BondGlyph kind={kind}/></svg><span>{label.replace(/（.*）/,'')}</span></button>)}
        <span className="bond-direction-hint">{paintBondKind==='up'||paintBondKind==='down'?'細い側から太い側へ描く · 逆になぞって向きを変更':'選んで描く · 結合をなぞって変更'}</span>
      </div>
      <div className="element-palette" role="toolbar" aria-label="原子と電荷">
        <span className="palette-label">原子</span>
        {['C','N','O','S','P','F','Cl','Br','I','H','B','Si'].map(element=><button key={element} className={atomMode&&paintElement===element&&!paintCharge?'selected':''} aria-label={`原子 ${element}`} aria-pressed={atomMode&&paintElement===element&&!paintCharge} title={`${element} を選んで頂点をなぞる`} onClick={()=>chooseElement(element)}>{element}</button>)}
        <span className="palette-divider"/>
        {([{element:'N',charge:1},{element:'O',charge:-1}] as const).map(({element,charge})=><button key={element} className={atomMode&&paintElement===element&&paintCharge===charge?'selected':''} aria-label={`原子 ${element}${charge>0?'+':'-'}`} aria-pressed={atomMode&&paintElement===element&&paintCharge===charge} title={`${chargedElementLabel(element,charge)} を頂点へ上書き`} onClick={()=>chooseElement(element,charge)}>{chargedElementLabel(element,charge)}</button>)}
        <div className="charge-picker" role="group" aria-label="描く原子の電荷">
          <span>電荷</span><button disabled={!atomMode||paintCharge<=-15} aria-label="描く原子の電荷を減らす" onClick={()=>chooseElement(paintElement,paintCharge-1)}><Minus size={13}/></button>
          <output aria-label="選択中の電荷">{paintCharge>0?'+':''}{paintCharge}</output>
          <button disabled={!atomMode||paintCharge>=15} aria-label="描く原子の電荷を増やす" onClick={()=>chooseElement(paintElement,paintCharge+1)}><Plus size={13}/></button>
          <button className="neutral-charge" disabled={!atomMode} aria-label="電荷を中性にする" onClick={()=>chooseElement(paintElement,0)}>中性</button>
        </div>
        <span className="palette-hint">{tool==='box-erase'?'四角で囲んでまとめて消す':atomMode?`${ionLabel}：頂点をなぞって変更`:'原子を選び、頂点をなぞる'}</span>
      </div>
      <aside className="toolbox" aria-label="道具箱"><div className="drawing-tools">
        <button aria-label="鉛筆" title="結合を描く (P)" aria-pressed={tool==='pencil'} className={tool==='pencil'?'active':''} onClick={()=>chooseElement(null)}><Pencil size={21}/><span>鉛筆</span></button>
        <button aria-label="消しゴム" title="消しゴム (Eを押している間)" aria-pressed={tool==='eraser'} className={tool==='eraser'?'active':''} onClick={()=>{setTool('eraser');resetInput();}}><Eraser size={21}/><span>消す</span></button>
        <button aria-label="範囲消去" title="四角で囲んでまとめて消す" aria-pressed={tool==='box-erase'} className={tool==='box-erase'?'active':''} onClick={()=>{setTool('box-erase');resetInput();}}><SquareDashed size={21}/><span>範囲消去</span></button>
        <button aria-label="選択と移動" title="選択と移動 (V)" aria-pressed={tool==='select'} className={tool==='select'?'active':''} onClick={()=>{setTool('select');resetInput();}}><MousePointer2 size={20}/><span>選択</span></button>
      </div><div className="tool-separator"/><button className="plain-tool" aria-label="元に戻す" title="元に戻す (⌘/Ctrl Z)" disabled={!history.past.length} onClick={undo}><Undo2 size={19}/></button><button className="plain-tool" aria-label="やり直す" title="やり直す (⌘/Ctrl Shift Z)" disabled={!history.future.length} onClick={redo}><Redo2 size={19}/></button><div className="tool-separator"/><button className="plain-tool" aria-label="新しいノート" title="新しいノート" onClick={()=>{resetInput();setNewOpen(true);}}><Plus size={20}/></button>
      </aside>
      {tool==='eraser'&&<div className="eraser-settings"><span>消しゴムの大きさ</span>{[4,7,12,20].map(n=><button key={n} aria-label={`消しゴム ${n}`} className={eraserSize===n?'selected':''} onClick={()=>setEraserSize(n)}><i style={{width:Math.min(n*1.3,22),height:Math.min(n*1.3,22)}}/></button>)}</div>}
      {selectedAtom&&<div className="atom-settings"><span>{selectedAtom.element} の電荷</span><button aria-label="負電荷を追加" onClick={()=>change({...sketch,atoms:sketch.atoms.map(a=>a.id===selected?{...a,charge:(a.charge??0)-1}:a)})}><Minus size={14}/></button><button aria-label="正電荷を追加" onClick={()=>change({...sketch,atoms:sketch.atoms.map(a=>a.id===selected?{...a,charge:(a.charge??0)+1}:a)})}><Plus size={14}/></button></div>}
      <SketchCanvas ref={canvas} sketch={sketch} tool={tool} paintElement={paintElement} paintCharge={paintCharge} paintBondKind={paintBondKind} eraserSize={eraserSize} resetKey={resetKey} grid={grid} onChange={change} onStatus={status} onSelect={setSelected} selected={selected}/>
      <div className="workspace-options"><button className={grid?'enabled':''} aria-label="方眼の表示を切り替え" title="方眼" onClick={()=>setGrid(g=>!g)}><Grid2X2 size={17}/></button><button aria-label="描き方を見る" title="描き方" onClick={()=>setHelp(h=>!h)}><HelpCircle size={19}/></button></div>
      {help&&<aside className="help-panel"><div className="help-heading"><h2>紙と同じように。</h2><button className="icon-button" aria-label="描き方を閉じる" onClick={()=>setHelp(false)}><X size={17}/></button></div><div className="help-step"><span className="help-drawing">⬡</span><div><strong>ざっくり、六角形。</strong><p>閉じた六角形を描くと、同じ大きさのベンゼン環に整います。</p></div></div><div className="help-step"><span className="help-drawing handwritten">N</span><div><strong>原子を選んで、頂点をなぞる。</strong><p>N、O、N⁺、O⁻を選び、頂点に上書き。電荷の＋／−で他のイオンも指定できます。</p></div></div><div className="help-step"><Eraser size={24}/><div><strong>いらない線を、消す。</strong><p>二重結合の片方をなぞると単結合に。横に線を足せば戻せます。</p></div></div><div className="help-step"><span className="help-drawing">━</span><div><strong>結合も、ボタンで選ぶ。</strong><p>単・二重・三重、手前・奥・不定を選んで描きます。既存の線もなぞって変更。くさびは細い側から太い側へ描きます。</p></div></div><div className="help-bottom"><kbd>⌘ / Ctrl Z</kbd> 元に戻す <kbd>Space</kbd> 紙面を動かす</div><p className="help-footnote">「範囲消去」で四角く囲めば、まとめて消せます。描いた線は構造式へ変換します。意図と違うときは Undo で戻せます。</p></aside>}
      {notice&&<div className="toast" role="status"><Check size={15}/><span>{notice}</span><button aria-label="通知を閉じる" onClick={()=>setNotice('')}><X size={14}/></button></div>}
    </main>
    <footer className="status-bar"><div className="structure-info">{analyzing?<LoaderCircle size={13} className="spin"/>:<span className="status-dot"/>}<span>{moleculeCount}</span>{analysis?.formula&&<><span className="footer-divider"/><strong className="formula" title={analysis.formula}>{analysis.formula.replace(/\s/g,'')}</strong>{Number.isFinite(Number(analysis.mass))&&<span className="mass">{Number(analysis.mass).toFixed(2)} g/mol</span>}</>}{!!analysis?.issues.length&&<span className={unspecifiedStereo?'stereo-note':'chemistry-issue'} title={analysis.issues.join('\n')}>{unspecifiedStereo?'立体配置は未指定':'構造を確認してください'}</span>}</div>
      {analysis?.smiles&&<button className="smiles-copy" title="SMILESをコピー" onClick={()=>navigator.clipboard.writeText(analysis.smiles).then(()=>status('SMILESをコピーしました')).catch(()=>status('コピーできませんでした。書き出しから保存してください。'))}><span className="smiles-label">SMILES</span><span>{analysis.smiles}</span><Copy size={12}/></button>}
      <span className="auto-format-state" aria-live="polite">{formatting?'構造式に整形中…':'自動整形 ON'}</span><span className="privacy"><ShieldCheck size={13}/> この端末だけで処理</span>
    </footer>
    <input ref={file} type="file" hidden accept=".te.json,.json,.mol,.sdf,.cdx,.cdxml,.smi,.smiles,.inchi,.cml,.ket" onChange={openFile}/>
    {exportOpen&&<ExportDialog sketch={sketch} formatting={formatting} onClose={()=>setExportOpen(false)} onStatus={status}/>}
    {importOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setImportOpen(false);}}><section className="small-dialog" role="dialog" aria-modal="true" aria-label="構造式を開く"><div className="dialog-heading"><div><span className="small-label">続きを、この紙で。</span><h2>構造式を開く</h2></div><button className="icon-button" aria-label="閉じる" onClick={()=>setImportOpen(false)}><X size={20}/></button></div><button className="file-drop" disabled={importing} onClick={()=>file.current?.click()}><Upload size={24}/><strong>ファイルを選ぶ</strong><span>MOL / SDF / CDX / CDXML / te ノート など</span></button><label className="paste-label" htmlFor="structure-input">または、SMILESなどを貼り付ける</label><textarea id="structure-input" value={importText} onChange={e=>setImportText(e.target.value)} placeholder="c1ccncc1" rows={4}/><p className="local-note">今のノートはUndoで戻せます。</p><button className="primary-button full-width" disabled={!importText.trim()||importing} onClick={()=>importData(importText)}>{importing?<LoaderCircle className="spin" size={16}/>:<ArrowUpRight size={16}/>} 紙面に開く</button></section></div>}
    {newOpen&&<div className="modal-backdrop"><section className="small-dialog" role="dialog" aria-modal="true" aria-label="新しいノート"><div className="dialog-heading"><h2>新しい紙をひらく</h2><button className="icon-button" aria-label="閉じる" onClick={()=>setNewOpen(false)}><X size={19}/></button></div><p>今のノートをファイルに残してから、新しい紙に描きはじめられます。</p><button className="secondary-button full-width" onClick={saveNote}><Download size={16}/> 今のノートを保存</button><button className="primary-button full-width" onClick={()=>{resetInput();change(emptySketch());setNewOpen(false);status('新しいノートを開きました。Undoで元に戻せます。');}}><FileText size={16}/> 新しいノートを開く</button></section></div>}
  </div>;
}
