import {test,expect,type Page} from '@playwright/test';
import type {Sketch} from '../src/core/types';

async function draw(page:Page,points:number[][]){
  const svg=page.getByTestId('sketch-canvas');
  const screen=await svg.evaluate((el,pts)=>{
    const svg=el as SVGSVGElement,matrix=svg.getScreenCTM()!;
    return pts.map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(matrix);return [p.x,p.y];});
  },points);
  await page.mouse.move(screen[0][0],screen[0][1]);await page.mouse.down();
  for(const [x,y] of screen.slice(1))await page.mouse.move(x,y,{steps:10});
  await page.mouse.up();
}
const stored=(page:Page):Promise<Sketch>=>page.evaluate(()=>JSON.parse(localStorage.getItem('te.sketch.v1')!));
async function ring(page:Page,x=320,y=260,r=85){
  await draw(page,Array.from({length:7},(_,i)=>[x+r*Math.cos(i*Math.PI/3),y+r*Math.sin(i*Math.PI/3)]));
  await expect.poll(async()=> (await stored(page)).atoms.length).toBeGreaterThan(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-formatting','false');
}
test('selected atom buttons paint vertices without letter recognition and share the valence and undo path',async({page})=>{
  await page.goto('/');await ring(page);const initial=await stored(page),a=initial.atoms[0];
  await page.getByRole('button',{name:'原子 N',exact:true}).click();
  await draw(page,[[a.x-8,a.y-6],[a.x+9,a.y+4],[a.x-6,a.y+8]]);
  await expect(page.locator('[data-element="N"]')).toHaveCount(1);
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);
  expect((await stored(page)).ink).toEqual([]);
  await expect(page.getByRole('button',{name:'原子 N',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'原子 O',exact:true}).click();
  const n=(await stored(page)).atoms.find(n=>n.id===a.id)!;
  await draw(page,[[n.x-9,n.y],[n.x+9,n.y]]);
  await expect(page.locator('[data-element="O"]')).toHaveCount(1);
  await expect(page.locator('.formula')).toHaveText('C5H6O');
  const oxygen=await stored(page);
  expect(oxygen.bonds.filter(b=>b.a===a.id||b.b===a.id).reduce((sum,b)=>sum+b.order,0)).toBe(2);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-element="N"]')).toHaveCount(1);
  await page.getByRole('button',{name:'やり直す',exact:true}).click();
  await expect(page.locator('[data-element="O"]')).toHaveCount(1);
});
test('atom painting follows zoom and the bond button returns to drawing bonds',async({page})=>{
  await page.goto('/');await ring(page);await page.getByRole('button',{name:'拡大',exact:true}).click();
  const a=(await stored(page)).atoms[0];
  await page.getByRole('button',{name:'原子 N',exact:true}).click();
  await draw(page,[[a.x-6,a.y-5],[a.x+6,a.y+5]]);
  await expect(page.locator('[data-element="N"]')).toHaveCount(1);
  await page.getByRole('button',{name:'結合を描く',exact:true}).click();
  await draw(page,[[650,390],[720,420]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(8);
  await expect(page.locator('[data-element="N"]')).toHaveCount(1);
});
test('rectangle drag previews and deletes an entire ring, preserves another, and undoes in one step',async({page})=>{
  await page.goto('/');await ring(page);await ring(page,700,260,125);
  await expect(page.locator('[data-atom-id]')).toHaveCount(12);
  const before=await stored(page);
  await page.getByRole('button',{name:'範囲消去',exact:true}).click();
  const box=await page.getByTestId('sketch-canvas').boundingBox();if(!box)throw Error('No paper');
  await page.mouse.move(box.x+420,box.y+350);await page.mouse.down();await page.mouse.move(box.x+220,box.y+160,{steps:10});
  await expect(page.locator('.erase-target')).toHaveCount(6);
  await expect(page.locator('.erase-selection')).toBeVisible();
  await page.mouse.up();await expect(page.locator('[data-atom-id]')).toHaveCount(6);
  expect((await stored(page)).atoms.map(a=>a.id)).toEqual(before.atoms.slice(6).map(a=>a.id));
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-atom-id]')).toHaveCount(12);
  expect((await stored(page)).bonds).toEqual(before.bonds);
});
test('Escape cancels a rectangle and a tiny click cannot erase an atom',async({page})=>{
  await page.goto('/');await ring(page);await page.getByRole('button',{name:'範囲消去',exact:true}).click();
  const box=await page.getByTestId('sketch-canvas').boundingBox();if(!box)throw Error('No paper');
  await page.mouse.move(box.x+220,box.y+160);await page.mouse.down();await page.mouse.move(box.x+420,box.y+350,{steps:10});
  await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('[data-atom-id]')).toHaveCount(6);
  const a=(await stored(page)).atoms[0];await draw(page,[[a.x,a.y]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);
});
test('rectangle erasing uses paper coordinates after zooming',async({page})=>{
  await page.goto('/');await ring(page);await page.getByRole('button',{name:'拡大',exact:true}).click();
  await page.getByRole('button',{name:'範囲消去',exact:true}).click();
  await draw(page,[[220,160],[420,350]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(0);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);
});
test('ambiguous handwriting becomes a structure and never remains as raw ink',async({page})=>{
  await page.goto('/');await draw(page,[[250,220],[310,270],[250,270],[310,220],[250,220]]);
  await expect.poll(async()=> (await stored(page)).atoms.length).toBeGreaterThan(0);
  expect((await stored(page)).ink).toEqual([]);
  await expect(page.getByText('手書きを残しました')).toHaveCount(0);
  await expect(page.locator('.formula')).not.toHaveText('');
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-atom-id]')).toHaveCount(0);
});
test('old ambiguous ink is converted when a saved note is opened',async({page})=>{
  const note={version:1,title:'残っていた筆跡',atoms:[],bonds:[],ink:[{id:'old',points:[[250,220],[310,270],[250,270],[310,220],[250,220]].map(([x,y])=>({x,y}))}]};
  await page.addInitScript(note=>localStorage.setItem('te.sketch.v1',JSON.stringify(note)),note);
  await page.goto('/');await expect.poll(async()=> (await stored(page)).atoms.length).toBeGreaterThan(0);
  expect((await stored(page)).ink).toEqual([]);
  await expect(page.locator('.raw-ink')).toHaveCount(0);
});
test('rings drawn at very different sizes and their bonds normalize to the same size',async({page})=>{
  await page.goto('/');await ring(page,300,260,40);await ring(page,700,260,145);
  await expect(page.locator('[data-atom-id]')).toHaveCount(12);
  await expect.poll(async()=>{
    const s=await stored(page);return Math.max(...s.bonds.map(b=>{const a=s.atoms.find(a=>a.id===b.a)!,c=s.atoms.find(a=>a.id===b.b)!;return Math.abs(Math.hypot(a.x-c.x,a.y-c.y)-60)}));
  }).toBeLessThan(.01);
});

test('a no-op retrace before a second bond line cannot absorb the earlier structure into Undo',async({page})=>{
  await page.goto('/');await draw(page,[[250,250],[310,250]]);
  await expect(page.locator('[data-bond-id]')).toHaveCount(1);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-formatting','false');
  await draw(page,[[250,250],[310,250]]);await page.waitForTimeout(450);
  await draw(page,[[256,260],[304,260]]);
  await expect(page.locator('[data-bond-id]')).toHaveCount(2);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-atom-id]')).toHaveCount(2);
  await expect(page.locator('[data-bond-id]')).toHaveCount(1);
});
