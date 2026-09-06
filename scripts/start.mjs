import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const url='http://127.0.0.1:4173/';
const marker='<meta name="application-name" content="te-hand-chemistry"';
async function running(){
  let response;
  try {response=await fetch(url,{signal:AbortSignal.timeout(1500)});}
  catch{return false;}
  if(response.ok&&(await response.text()).includes(marker))return true;
  throw Error('ポート4173を別のアプリが使用しています。そのアプリを終了してから、もう一度起動してください。');
}
try {
  if(!await running()){
    const log=openSync(new URL('../.te-preview.log',import.meta.url),'a');
    const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url)),'preview','--host','127.0.0.1','--port','4173','--strictPort'],{cwd:root,detached:true,stdio:['ignore',log,log]});
    closeSync(log);
    let failure;child.on('error',error=>{failure=error;});child.unref();
    let ready=false;
    for(let attempt=0;attempt<30;attempt++){
      if(failure)throw failure;
      if(await running()){ready=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!ready){child.kill();throw Error('起動できませんでした。.te-preview.log を確認してください。');}
  }
  console.log(`\nte を起動しました: ${url}\nこのターミナルを閉じてもアプリの配信は続きます。`);
} catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}
