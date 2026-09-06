import {test,expect,type Page} from '@playwright/test';
import type {Sketch} from '../src/core/types';

const stored=(page:Page):Promise<Sketch>=>page.evaluate(()=>JSON.parse(localStorage.getItem('te.sketch.v1')!));
async function draw(page:Page,points:number[][]){
  const screen=await page.getByTestId('sketch-canvas').evaluate((el,pts)=>pts.map(([x,y])=>{
    const p=new DOMPoint(x,y).matrixTransform((el as SVGSVGElement).getScreenCTM()!);return [p.x,p.y];
  }),points);
  await page.mouse.move(screen[0][0],screen[0][1]);await page.mouse.down();
  for(const [x,y] of screen.slice(1))await page.mouse.move(x,y,{steps:10});
  await page.mouse.up();
}
async function ready(page:Page){await expect(page.locator('.app-shell')).toHaveAttribute('data-formatting','false');}

for(const [label,order,stereo] of [['単結合',1,undefined],['二重結合',2,undefined],['三重結合',3,undefined],['手前（くさび）',1,'up'],['奥（破線くさび）',1,'down'],['不定（波線）',1,'either']] as const){
  test(`${label} can be selected and drawn directly as a chemical bond`,async({page})=>{
    await page.goto('/');await page.getByRole('button',{name:label,exact:true}).click();
    await draw(page,[[300,250],[360,250]]);
    await expect(page.locator('[data-atom-id]')).toHaveCount(2);
    await ready(page);const s=await stored(page);
    expect(s.bonds).toHaveLength(1);expect(s.bonds[0].order).toBe(order);expect(s.bonds[0].stereo).toBe(stereo);
    expect(s.ink).toEqual([]);
    await expect(page.locator('.smiles-copy')).toContainText(order===3?'C#C':order===2?'C=C':'CC');
    if(stereo==='up')await expect(page.locator('.molecule polygon')).toHaveCount(1);
    else if(stereo==='down')expect(await page.locator('.molecule [data-bond-id] line').count()).toBeGreaterThan(3);
    else if(stereo==='either')await expect(page.locator('.molecule [data-bond-id] polyline')).toHaveCount(1);
    else await expect(page.locator('.molecule [data-bond-id]')).toHaveCount(order);
  });
}

test('selected bond styles replace the same bond, reverse wedges with drag direction, and undo once',async({page})=>{
  await page.goto('/');await draw(page,[[300,250],[360,250]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(2);await ready(page);
  const before=await stored(page),id=before.bonds[0].id;
  await page.getByRole('button',{name:'二重結合',exact:true}).click();await draw(page,[[306,251],[354,250]]);
  await expect.poll(async()=> (await stored(page)).bonds[0].order).toBe(2);
  await page.getByRole('button',{name:'手前（くさび）',exact:true}).click();await draw(page,[[305,250],[355,250]]);
  await expect(page.locator('.molecule polygon')).toHaveCount(1);await ready(page);
  const forward=await stored(page);expect(forward.bonds[0].id).toBe(id);
  const a=forward.atoms.find(a=>a.id===forward.bonds[0].a)!,b=forward.atoms.find(a=>a.id===forward.bonds[0].b)!;
  await draw(page,[[b.x,b.y],[a.x,a.y]]);
  await expect.poll(async()=> (await stored(page)).bonds[0].a).toBe(b.id);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect.poll(async()=> (await stored(page)).bonds[0].a).toBe(a.id);
  await page.getByRole('button',{name:'単結合',exact:true}).click();
  await draw(page,[[(a.x+b.x)/2,(a.y+b.y)/2]]);
  await expect(page.locator('.molecule polygon')).toHaveCount(0);
  expect((await stored(page)).bonds[0]).toMatchObject({id,order:1});
  expect((await stored(page)).bonds[0].stereo).toBeUndefined();
  await expect(page.locator('[data-atom-id]')).toHaveCount(2);
});

test('N+ and O- presets paint real charges; neutral and Undo restore previous charge',async({page})=>{
  await page.goto('/');await draw(page,[[300,250],[360,250]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(2);await ready(page);
  const a=(await stored(page)).atoms[0];
  await page.getByRole('button',{name:'原子 N+',exact:true}).click();await draw(page,[[a.x-5,a.y],[a.x+5,a.y]]);
  await expect.poll(async()=> (await stored(page)).atoms.find(n=>n.id===a.id)?.charge).toBe(1);
  await expect(page.locator(`[data-atom-id="${a.id}"]`)).toHaveText('N+');
  await expect(page.locator('.smiles-copy')).toContainText('+');
  await page.getByRole('button',{name:'電荷を中性にする',exact:true}).click();await draw(page,[[a.x,a.y]]);
  await expect.poll(async()=> (await stored(page)).atoms.find(n=>n.id===a.id)?.charge??0).toBe(0);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect.poll(async()=> (await stored(page)).atoms.find(n=>n.id===a.id)?.charge).toBe(1);
  await page.getByRole('button',{name:'原子 O-',exact:true}).click();await draw(page,[[a.x,a.y]]);
  await expect.poll(async()=> (await stored(page)).atoms.find(n=>n.id===a.id)?.charge).toBe(-1);
  await expect(page.locator('.smiles-copy')).toContainText('-');
  await page.getByRole('button',{name:'書き出す',exact:true}).click();
  await page.getByRole('button',{name:'MOL V3000',exact:true}).click();
  await expect(page.getByTestId('export-preview')).toContainText('CHG=-1');
});

test('charge controls apply to the selected element and bond tools leave atom mode',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'原子 N',exact:true}).click();
  await page.getByRole('button',{name:'描く原子の電荷を増やす',exact:true}).click();
  await draw(page,[[300,250]]);
  await expect.poll(async()=> (await stored(page)).atoms[0]?.charge).toBe(1);
  await page.getByRole('button',{name:'単結合',exact:true}).click();await draw(page,[[300,250],[360,250]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(2);
  expect((await stored(page)).atoms.map(a=>a.element)).toEqual(['N','C']);
  await page.getByRole('button',{name:'結合を描く',exact:true}).click();
  await expect(page.getByRole('button',{name:'単結合',exact:true})).toHaveAttribute('aria-pressed','false');
});

test('bond painting follows zoom and a perpendicular new branch is not mistaken for a style edit',async({page})=>{
  await page.goto('/');await draw(page,[[300,250],[360,250]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(2);await ready(page);
  await page.getByRole('button',{name:'拡大',exact:true}).click();
  await page.getByRole('button',{name:'二重結合',exact:true}).click();await draw(page,[[300,250],[360,250]]);
  await expect.poll(async()=> (await stored(page)).bonds[0].order).toBe(2);
  await page.getByRole('button',{name:'単結合',exact:true}).click();await draw(page,[[360,250],[360,310]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(3);
  expect((await stored(page)).bonds.map(b=>b.order)).toEqual([2,1]);
});

test('a wedge on an unfinished stereocenter keeps chemical analysis and MOL export available',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'開く',exact:true}).click();
  await page.getByLabel('または、SMILESなどを貼り付ける').fill('C1C=CC=C(O)C=1/N=N/CCC');
  await page.getByRole('button',{name:'紙面に開く',exact:true}).click();
  await expect(page.locator('[data-atom-id]')).toHaveCount(12);await ready(page);
  const before=await stored(page),end=before.atoms.find(a=>a.element==='C'&&before.bonds.filter(b=>b.a===a.id||b.b===a.id).length===1)!;
  const bond=before.bonds.find(b=>b.a===end.id||b.b===end.id)!,start=before.atoms.find(a=>a.id===(bond.a===end.id?bond.b:bond.a))!;
  await page.getByRole('button',{name:'手前（くさび）',exact:true}).click();await draw(page,[[start.x,start.y],[end.x,end.y]]);
  await expect(page.locator('.molecule polygon')).toHaveCount(1);await ready(page);
  await page.getByRole('button',{name:'書き出す',exact:true}).click();await page.getByRole('button',{name:'InChI',exact:true}).click();
  await expect(page.getByTestId('export-preview')).toContainText('InChI=1S/');
  await page.getByRole('button',{name:'MOL V3000',exact:true}).click();
  await expect(page.getByTestId('export-preview')).toContainText('V3000');
  await expect(page.getByRole('button',{name:'ファイルを保存',exact:true})).toBeEnabled();
});
