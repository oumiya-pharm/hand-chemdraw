import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function draw(page:Page, points:{x:number;y:number}[]) {
  const box=await page.getByTestId('sketch-canvas').boundingBox();if(!box)throw Error('No paper');
  await page.mouse.move(box.x+points[0].x,box.y+points[0].y);await page.mouse.down();
  for(const p of points.slice(1))await page.mouse.move(box.x+p.x,box.y+p.y,{steps:12});
  await page.mouse.up();await page.waitForTimeout(420);
}
async function rightmost(page:Page){
  await expect(page.locator('.app-shell')).toHaveAttribute('data-formatting','false');
  return page.locator('[data-atom-id]').evaluateAll(nodes=>nodes.map(el=>({x:Number(el.getAttribute('data-x')),y:Number(el.getAttribute('data-y'))})).sort((a,b)=>b.x-a.x)[0]);
}
test('paper, pencil and eraser complete a chemical editing loop',async({page})=>{
  await page.goto('/');
  await draw(page,[{x:500,y:280},{x:450,y:367},{x:350,y:367},{x:300,y:280},{x:350,y:193},{x:450,y:193},{x:500,y:280}]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);
  await expect(page.locator('[data-bond-id]')).toHaveCount(9);
  const a=await rightmost(page);
  await draw(page,[{x:a.x-13,y:a.y+13},{x:a.x-13,y:a.y-13},{x:a.x+13,y:a.y+13},{x:a.x+13,y:a.y-13}]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);
  await expect(page.locator('[data-element="N"]')).toHaveCount(1);
  await page.getByRole('button',{name:'消しゴム',exact:true}).click();
  const line=page.locator('[data-bond-index="1"]').first();
  const coords=await line.evaluate(el=>({x1:Number(el.getAttribute('x1')),y1:Number(el.getAttribute('y1')),x2:Number(el.getAttribute('x2')),y2:Number(el.getAttribute('y2'))}));
  await draw(page,[{x:coords.x1,y:coords.y1},{x:coords.x2,y:coords.y2}]);
  await expect(page.locator('[data-bond-id]')).toHaveCount(8);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-bond-id]')).toHaveCount(9);
  await page.reload();
  await expect(page.locator('[data-element="N"]')).toHaveCount(1);
  await page.getByRole('button',{name:'書き出す',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('export-preview')).not.toHaveText('');
});

test('slow multi-stroke N replaces one atom and undo restores the carbon',async({page})=>{
  await page.goto('/');
  await draw(page,[{x:500,y:280},{x:450,y:367},{x:350,y:367},{x:300,y:280},{x:350,y:193},{x:450,y:193},{x:500,y:280}]);
  const a=await rightmost(page);
  await draw(page,[{x:a.x-13,y:a.y-13},{x:a.x-13,y:a.y+13}]);
  await page.waitForTimeout(500);
  await draw(page,[{x:a.x-13,y:a.y-13},{x:a.x+13,y:a.y+13}]);
  await page.waitForTimeout(500);
  await draw(page,[{x:a.x+13,y:a.y-13},{x:a.x+13,y:a.y+13}]);
  await expect(page.locator('[data-element="N"]')).toHaveCount(1);
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);
  await expect(page.locator('[data-bond-id]')).toHaveCount(9);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-element="N"]')).toHaveCount(0);
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);
});

test('all three double bonds can be erased and drawn back without changing the ring',async({page})=>{
  await page.goto('/');
  await draw(page,[{x:500,y:280},{x:450,y:367},{x:350,y:367},{x:300,y:280},{x:350,y:193},{x:450,y:193},{x:500,y:280}]);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-formatting','false');
  const erased:{x:number;y:number}[][]=[];
  await page.getByRole('button',{name:'消しゴム',exact:true}).click();
  for(let i=0;i<3;i++){
    const coords=await page.locator('[data-bond-index="1"]').first().evaluate(el=>[{x:Number(el.getAttribute('x1')),y:Number(el.getAttribute('y1'))},{x:Number(el.getAttribute('x2')),y:Number(el.getAttribute('y2'))}]);
    erased.push(coords);await draw(page,coords);
  }
  await expect(page.locator('[data-bond-id]')).toHaveCount(6);
  await expect(page.locator('.formula')).toHaveText('C6H12');
  await page.getByRole('button',{name:'鉛筆',exact:true}).click();
  for(const points of erased)await draw(page,points);
  await expect(page.locator('[data-bond-id]')).toHaveCount(9);
  await expect(page.locator('.formula')).toHaveText('C6H6');
});

test('drawing consecutive distant strokes keeps both structures',async({page})=>{
  await page.goto('/');const box=await page.getByTestId('sketch-canvas').boundingBox();if(!box)throw Error('No paper');
  for(const [x,y] of [[250,250],[650,450]]){
    await page.mouse.move(box.x+x,box.y+y);await page.mouse.down();await page.mouse.move(box.x+x+80,box.y+y,{steps:5});await page.mouse.up();
  }
  await expect(page.locator('[data-bond-id]')).toHaveCount(2);
  await expect(page.locator('[data-atom-id]')).toHaveCount(4);
});

test('switching to the eraser immediately after drawing does not discard the stroke',async({page})=>{
  await page.goto('/');const box=await page.getByTestId('sketch-canvas').boundingBox();if(!box)throw Error('No paper');
  await page.mouse.move(box.x+250,box.y+250);await page.mouse.down();await page.mouse.move(box.x+330,box.y+250,{steps:5});await page.mouse.up();
  await page.getByRole('button',{name:'消しゴム',exact:true}).click();
  await expect(page.locator('[data-bond-id]')).toHaveCount(1);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-bond-id]')).toHaveCount(0);
});

test('saving immediately after a stroke includes that structure in the file',async({page})=>{
  await page.goto('/');const box=await page.getByTestId('sketch-canvas').boundingBox();if(!box)throw Error('No paper');
  await page.mouse.move(box.x+250,box.y+250);await page.mouse.down();await page.mouse.move(box.x+330,box.y+250,{steps:5});await page.mouse.up();
  const saved=page.waitForEvent('download');await page.keyboard.press('ControlOrMeta+s');
  const path=await (await saved).path();if(!path)throw Error('No downloaded file');
  const note=JSON.parse(await readFile(path,'utf8'));
  expect(note.atoms).toHaveLength(2);expect(note.bonds).toHaveLength(1);
});

test('editor shortcuts cannot change the structure behind an open dialog',async({page})=>{
  await page.goto('/');await draw(page,[{x:250,y:250},{x:330,y:250}]);
  await page.getByRole('button',{name:'新しいノート',exact:true}).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-bond-id]')).toHaveCount(1);
});

test('keyboard tool switches preserve moved atoms when drawing resumes nearby',async({page})=>{
  await page.goto('/');await draw(page,[{x:250,y:250},{x:330,y:250}]);
  const before=await rightmost(page);
  await page.keyboard.press('v');await draw(page,[before,{x:before.x,y:before.y+40}]);
  const moved=await rightmost(page);
  await page.keyboard.press('p');await draw(page,[moved,{x:moved.x+60,y:moved.y+30}]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(3);
  await expect(page.locator('[data-bond-id]')).toHaveCount(2);
});

const formats=['SMILES','MOL V3000','MOL V2000','SDF V3000','SDF V2000','ChemDraw CDXML','ChemDraw CDX','InChI','InChIKey','CML','KET','SVG','PNG','JPEG','ノートを保存'];
// Each format gets a fresh context, as a user's single export would.
for(const format of formats)test(`downloads a valid ${format} file`,async({page})=>{
  await page.goto('/');await draw(page,[{x:500,y:280},{x:450,y:367},{x:350,y:367},{x:300,y:280},{x:350,y:193},{x:450,y:193},{x:500,y:280}]);
  await page.getByRole('button',{name:'書き出す',exact:true}).click();
    await page.getByRole('button',{name:format,exact:true}).click();
    const save=page.getByRole('button',{name:'ファイルを保存',exact:true});await expect(save).toBeEnabled();
    const saved=page.waitForEvent('download');await save.click();const path=await (await saved).path();if(!path)throw Error('No downloaded file');
    const bytes=await readFile(path),text=bytes.toString('utf8');expect(bytes.length).toBeGreaterThan(8);
    if(format==='PNG')expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
    else if(format==='JPEG')expect(bytes.subarray(0,3).toString('hex')).toBe('ffd8ff');
    else if(format==='ChemDraw CDX')expect(text.slice(0,8)).toBe('VjCD0100');
    else if(format==='ChemDraw CDXML')expect(text).toContain('<CDXML');
    else if(format.startsWith('MOL')||format.startsWith('SDF')){expect(text).toContain(format.endsWith('3000')?'V3000':'V2000');if(format.startsWith('SDF'))expect(text).toContain('$$$$');}
    else if(format==='InChI')expect(text).toContain('InChI=1S/C6H6');
    else if(format==='InChIKey')expect(text.trim()).toMatch(/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/);
    else if(format==='SVG')expect(text).toContain('<svg');
    else if(format==='CML')expect(text).toContain('<molecule');
    else if(format==='KET')expect(JSON.parse(text).root).toBeDefined();
    else if(format==='ノートを保存')expect(JSON.parse(text).atoms).toHaveLength(6);
    else expect(text).toMatch(/c1ccccc1|C1C=CC=CC=1/);
});
