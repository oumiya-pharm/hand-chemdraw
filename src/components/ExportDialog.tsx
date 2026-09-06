import { useEffect, useRef, useState } from 'react';
import { X, Download, Copy, Check, FileCode2, Image, FileJson, LoaderCircle } from 'lucide-react';
import { chemistry, type ChemicalFormat } from '../chemistry/client';
import type { Sketch } from '../core/types';
import { toSvg } from '../core/render';
import { download } from '../storage';

const chemicalFormats:{id:ChemicalFormat;name:string;description:string;extension:string;mime:string}[]=[
  {id:'smiles',name:'SMILES',description:'構造を一行の文字列に',extension:'smi',mime:'text/plain'},
  {id:'mol-v3000',name:'MOL V3000',description:'座標を持つ分子構造',extension:'mol',mime:'chemical/x-mdl-molfile'},
  {id:'mol-v2000',name:'MOL V2000',description:'広く使われる分子形式',extension:'mol',mime:'chemical/x-mdl-molfile'},
  {id:'sdf-v3000',name:'SDF V3000',description:'分子構造データ',extension:'sdf',mime:'chemical/x-mdl-sdfile'},
  {id:'sdf-v2000',name:'SDF V2000',description:'分子構造データ',extension:'sdf',mime:'chemical/x-mdl-sdfile'},
  {id:'cdxml',name:'ChemDraw CDXML',description:'ChemDrawで編集を続ける',extension:'cdxml',mime:'chemical/x-cdxml'},
  {id:'cdx',name:'ChemDraw CDX',description:'ChemDrawのバイナリ形式',extension:'cdx',mime:'chemical/x-cdx'},
  {id:'inchi',name:'InChI',description:'標準の化学識別子',extension:'inchi',mime:'text/plain'},
  {id:'inchi-key',name:'InChIKey',description:'構造の識別キー',extension:'txt',mime:'text/plain'},
  {id:'cml',name:'CML',description:'化学構造のXML',extension:'cml',mime:'chemical/x-cml'},
  {id:'ket',name:'KET',description:'Ketcherの構造形式',extension:'ket',mime:'application/json'},
];
type Format=ChemicalFormat|'svg'|'png'|'jpeg'|'native';
export default function ExportDialog({sketch,onClose,onStatus,formatting=false}:{sketch:Sketch;onClose:()=>void;onStatus:(s:string)=>void;formatting?:boolean}) {
  const [format,setFormat]=useState<Format>(sketch.atoms.length?'smiles':'native');
  const [result,setResult]=useState<string|Uint8Array>(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),[copied,setCopied]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const graphic=['svg','png','jpeg'].includes(format),native=format==='native';
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  useEffect(()=>{
    let active=true;setError('');setResult('');setCopied(false);
    if(native){setResult(JSON.stringify(sketch,null,2));setLoading(false);return;}
    if(graphic){setResult(toSvg(sketch,false));setLoading(false);return;}
    setLoading(true);chemistry.convert(sketch,format as ChemicalFormat).then(r=>{if(active)setResult(r);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[format,sketch,graphic,native]);
  const filename=(sketch.title||'structure').replace(/[\\/:*?"<>|]/g,'_');
  async function save(){
    if(loading||formatting)return;
    try {
      if(format==='png'||format==='jpeg'){
        const blob=new Blob([result as string],{type:'image/svg+xml'}),url=URL.createObjectURL(blob);
        try{const image=new window.Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=Math.ceil(image.width*3);canvas.height=Math.ceil(image.height*3);const ctx=canvas.getContext('2d')!;if(format==='jpeg'){ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);}ctx.drawImage(image,0,0,canvas.width,canvas.height);const data=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('画像を作成できませんでした。')),`image/${format}`,.95));download(new Uint8Array(await data.arrayBuffer()),`${filename}.${format==='jpeg'?'jpg':'png'}`,data.type);}finally{URL.revokeObjectURL(url);}
      }else if(format==='svg')download(result,`${filename}.svg`,'image/svg+xml');
      else if(format==='native')download(result,`${filename}.te.json`,'application/json');
      else{const meta=chemicalFormats.find(f=>f.id===format)!;download(result,`${filename}.${meta.extension}`,meta.mime);}
      onStatus('ファイルを書き出しました');
    }catch(e){setError(e instanceof Error?e.message:'書き出せませんでした。');}
  }
  async function copy(){try{await navigator.clipboard.writeText(result as string);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setError('コピーできませんでした。ファイルとして保存できます。');}}
  return <dialog ref={dialog} className="export-dialog" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="dialog-heading"><div><span className="small-label">ノートから書き出す</span><h2>次の仕事へ、つなぐ。</h2></div><button className="icon-button" aria-label="閉じる" onClick={onClose}><X size={20}/></button></div>
    <div className="export-body"><nav className="format-list" aria-label="出力形式"><span className="format-group"><FileCode2 size={14}/> 化学構造</span>{chemicalFormats.map(f=><button key={f.id} disabled={!sketch.atoms.length} className={format===f.id?'chosen':''} onClick={()=>setFormat(f.id)}>{f.name}{format===f.id&&<Check size={14}/>}</button>)}<span className="format-group"><Image size={14}/> 画像</span>{(['svg','png','jpeg'] as const).map(f=><button key={f} className={format===f?'chosen':''} onClick={()=>setFormat(f)}>{f.toUpperCase()}{format===f&&<Check size={14}/>}</button>)}<span className="format-group"><FileJson size={14}/> ノート</span><button className={native?'chosen':''} onClick={()=>setFormat('native')}>ノートを保存{native&&<Check size={14}/>}</button></nav>
    <div className="export-detail"><div className="preview-heading"><strong>{native?'te ノート':graphic?format.toUpperCase():chemicalFormats.find(f=>f.id===format)?.name}</strong><span>{native?'構造・配置を保持':graphic?'紙面と同じ配置で':chemicalFormats.find(f=>f.id===format)?.description}</span></div>
      {loading||formatting?<div className="loading-preview"><LoaderCircle className="spin" size={22}/><span>{formatting?'構造式を整えています':'構造式を変換しています'}</span></div>:error?<div className="export-error" role="alert">{error}</div>:graphic?<div className="image-preview"><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(result as string)}`} alt="構造式の出力プレビュー"/></div>:<pre data-testid="export-preview" className="code-preview">{result instanceof Uint8Array?`ChemDraw CDX\n\n${result.byteLength.toLocaleString()} bytes\nバイナリファイルとして保存します。`:result}</pre>}
      <p className="local-note">この端末の中で変換します。</p>
      <div className="export-actions">{typeof result==='string'&&!graphic&&<button className="secondary-button" onClick={copy} disabled={loading||formatting||!!error||!result}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'コピーしました':'コピー'}</button>}<button className="primary-button" onClick={save} disabled={loading||formatting||!!error||!result}><Download size={16}/> ファイルを保存</button></div>
    </div></div>
  </dialog>;
}
