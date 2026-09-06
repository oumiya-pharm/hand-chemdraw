import {test,expect,type Page} from '@playwright/test';

async function draw(page:Page,points:number[][]){
  const box=await page.getByTestId('sketch-canvas').boundingBox();if(!box)throw Error('Missing canvas');
  await page.mouse.move(box.x+points[0][0],box.y+points[0][1]);await page.mouse.down();
  for(const [x,y] of points.slice(1))await page.mouse.move(box.x+x,box.y+y,{steps:12});
  await page.mouse.up();
}
const stored=(page:Page)=>page.evaluate(()=>JSON.parse(localStorage.getItem('te.sketch.v1')!));

test('an uneven hand-drawn chain automatically becomes equal-length chemical bonds',async({page})=>{
  await page.goto('/');await draw(page,[[250,220],[345,270],[390,200],[540,275]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(4);
  await expect.poll(async()=>{
    const s=await stored(page);const lengths=s.bonds.map((b:any)=>{const a=s.atoms.find((a:any)=>a.id===b.a),c=s.atoms.find((a:any)=>a.id===b.b);return Math.hypot(a.x-c.x,a.y-c.y)});
    return Math.max(...lengths)/Math.min(...lengths);
  }).toBeLessThan(1.02);
  const s=await stored(page);const neighbors=s.bonds.filter((b:any)=>b.a===s.atoms[1].id||b.b===s.atoms[1].id).map((b:any)=>s.atoms.find((a:any)=>a.id===(b.a===s.atoms[1].id?b.b:b.a)));
  const center=s.atoms[1],u=[neighbors[0].x-center.x,neighbors[0].y-center.y],v=[neighbors[1].x-center.x,neighbors[1].y-center.y];
  expect(Math.acos((u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)))*180/Math.PI).toBeCloseTo(120,0);
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();await expect(page.locator('[data-atom-id]')).toHaveCount(0);
});

test('writing O on benzene repairs the adjacent double bond to respect oxygen valence',async({page})=>{
  await page.goto('/');await draw(page,[[500,280],[450,367],[350,367],[300,280],[350,193],[450,193],[500,280]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);await page.waitForTimeout(700);
  const initial=await stored(page),a=initial.atoms.reduce((best:any,a:any)=>a.x>best.x?a:best);
  const circle=Array.from({length:30},(_,i)=>[a.x+12*Math.cos(i*2*Math.PI/29),a.y+14*Math.sin(i*2*Math.PI/29)]);
  await draw(page,circle);await expect(page.locator('[data-element="O"]')).toHaveCount(1);
  await expect.poll(async()=>{const s=await stored(page),o=s.atoms.find((a:any)=>a.element==='O');return s.bonds.filter((b:any)=>b.a===o.id||b.b===o.id).reduce((n:number,b:any)=>n+b.order,0)}).toBe(2);
  await expect(page.locator('.formula')).toHaveText('C5H6O');
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);
});

test('a fifth carbon bond is rejected automatically without breaking the four existing bonds',async({page})=>{
  const note={version:1,title:'炭素の原子価',ink:[],atoms:[{id:'center',x:400,y:350,element:'C'},...[[480,350],[320,350],[400,270],[400,430]].map(([x,y],i)=>({id:`a${i}`,x,y,element:'C'}))],bonds:Array.from({length:4},(_,i)=>({id:`b${i}`,a:'center',b:`a${i}`,order:1}))};
  await page.addInitScript(note=>localStorage.setItem('te.sketch.v1',JSON.stringify(note)),note);
  await page.goto('/');await expect(page.locator('.formula')).toHaveText('C5H12');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-formatting','false');
  const initial=await stored(page),center=initial.atoms.find((a:any)=>a.id==='center');
  await draw(page,[[center.x,center.y],[center.x+75,center.y+75]]);
  await expect(page.locator('.toast[role="status"]')).toContainText('価数');
  await expect(page.locator('[data-atom-id]')).toHaveCount(5);await expect(page.locator('[data-bond-id]')).toHaveCount(4);
  await expect(page.locator('.formula')).toHaveText('C5H12');
});

async function slowChemistry(page:Page){
  await page.context().route('**/*.wasm*',async route=>{await new Promise(resolve=>setTimeout(resolve,1200));await route.continue();});
}

test('cleanup after Undo preserves Redo when a following stroke interrupted the first cleanup',async({page})=>{
  await slowChemistry(page);await page.goto('/');await draw(page,[[250,220],[345,270],[390,200],[540,275]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(4);
  await draw(page,[[700,450],[800,500]]);await expect(page.locator('[data-atom-id]')).toHaveCount(6);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-formatting','false');
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-atom-id]')).toHaveCount(4);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-formatting','false');
  await expect(page.getByRole('button',{name:'やり直す',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'やり直す',exact:true}).click();await expect(page.locator('[data-atom-id]')).toHaveCount(6);
});

test('Escape cancels a pending stroke without leaving automatic cleanup stuck',async({page})=>{
  await slowChemistry(page);await page.goto('/');await draw(page,[[250,220],[345,270],[390,200],[540,275]]);
  await expect(page.locator('[data-atom-id]')).toHaveCount(4);
  await draw(page,[[700,450],[800,500]]);await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-formatting','false');
  await expect(page.locator('[data-atom-id]')).toHaveCount(4);
  const s=await stored(page),lengths=s.bonds.map((b:any)=>{const a=s.atoms.find((a:any)=>a.id===b.a),c=s.atoms.find((a:any)=>a.id===b.b);return Math.hypot(a.x-c.x,a.y-c.y)});
  expect(Math.max(...lengths)/Math.min(...lengths)).toBeLessThan(1.02);
});

test('saved unresolved ring ink is recovered as a chemical ring and can be undone',async({page})=>{
  const points=Array.from({length:80},(_,i)=>({x:420+80*Math.cos(i*2*Math.PI/79),y:300+74*Math.sin(i*2*Math.PI/79)}));
  const note={version:1,title:'前の手書き',atoms:[],bonds:[],ink:[{id:'old-ring',points}]};
  await page.addInitScript(note=>localStorage.setItem('te.sketch.v1',JSON.stringify(note)),note);
  await page.goto('/');await expect(page.locator('[data-atom-id]')).toHaveCount(6);await expect(page.locator('.formula')).toHaveText('C6H6');
  await page.getByRole('button',{name:'元に戻す',exact:true}).click();
  await expect(page.locator('[data-atom-id]')).toHaveCount(0);await expect(page.locator('.raw-ink')).toHaveCount(1);
});

test('six separately drawn edges at the paper bond scale close into a benzene ring',async({page})=>{
  await page.goto('/');const points=Array.from({length:7},(_,i)=>[400+60*Math.cos(i*Math.PI/3),280+60*Math.sin(i*Math.PI/3)]);
  for(let i=1;i<points.length;i++){
    await draw(page,[points[i-1],points[i]]);await page.waitForTimeout(600);
  }
  await expect(page.locator('[data-atom-id]')).toHaveCount(6);
  await expect(page.locator('[data-bond-id]')).toHaveCount(9);
  await expect(page.locator('.formula')).toHaveText('C6H6');
});
