import { describe, expect, it } from 'vitest';
import { atomLabels, bondLines, bondMarks, regularBondLines, toSvg } from './render';
import { emptySketch, type Sketch } from './types';
const fixture = (stereo?: 'up'|'down'|'either'):Sketch => ({...emptySketch(),atoms:[{id:'a',element:'C',x:0,y:0},{id:'b',element:'C',x:60,y:0}],bonds:[{id:'ab',a:'a',b:'b',order:1,stereo}]});
describe('stereochemical bond rendering',()=>{
  it('retains hit-test centerlines while replacing visible stereo lines',()=>{
    for(const stereo of ['up','down','either'] as const){expect(bondLines(fixture(stereo))).toHaveLength(1);expect(regularBondLines(fixture(stereo))).toHaveLength(0);expect(bondMarks(fixture(stereo))).toHaveLength(1);}
    expect(regularBondLines(fixture())).toHaveLength(1);
  });
  it('anchors the narrow wedge tip at a, including a reversed bond',()=>{
    const sketch=fixture('up'),mark=bondMarks(sketch)[0];
    expect(mark.kind).toBe('wedge');if(mark.kind!=='wedge')throw Error('expected wedge');
    expect(mark.points[0]).toEqual({x:0,y:0});expect(mark.points[1].x).toBe(60);expect(mark.points[1].y).toBeGreaterThan(0);expect(mark.points[2].y).toBeLessThan(0);
    sketch.bonds[0].a='b';sketch.bonds[0].b='a';const reversed=bondMarks(sketch)[0];if(reversed.kind!=='wedge')throw Error('expected wedge');expect(reversed.points[0]).toEqual({x:60,y:0});
  });
  it('widens hash strokes from a to b and waves around the bond axis',()=>{
    const hash=bondMarks(fixture('down'))[0];if(hash.kind!=='hash')throw Error('expected hash');
    expect(hash.segments.length).toBeGreaterThan(3);expect(Math.abs(hash.segments[0].to.y-hash.segments[0].from.y)).toBeLessThan(Math.abs(hash.segments.at(-1)!.to.y-hash.segments.at(-1)!.from.y));
    const either=bondMarks(fixture('either'))[0];if(either.kind!=='either')throw Error('expected either');expect(either.points[0]).toEqual({x:0,y:0});expect(either.points.at(-1)).toEqual({x:60,y:0});expect(either.points.some(p=>p.y>0)).toBe(true);expect(either.points.some(p=>p.y<0)).toBe(true);
  });
  it('exports distinct geometry without a plain line beneath a wedge',()=>{
    expect(toSvg(fixture('up'))).toContain('<polygon');expect(toSvg(fixture('up'))).not.toContain('<line ');
    expect((toSvg(fixture('down')).match(/<line /g)||[]).length).toBeGreaterThan(3);expect(toSvg(fixture('either'))).toContain('<polyline');
  });
});
describe('atom labels',()=>{
  it('shows decorated bonded carbon with isotope, hydrogen subscript and charge',()=>{
    const sketch=fixture();Object.assign(sketch.atoms[0],{isotope:13,hydrogens:2,charge:-1});
    expect(atomLabels(sketch)[0].parts).toEqual([{text:'13',script:'super'},{text:'C'},{text:'H'},{text:'2',script:'sub'},{text:'−',script:'super'}]);
    const svg=toSvg(sketch);expect(svg).toContain('>13</tspan>');expect(svg).toContain('baseline-shift="sub"');expect(svg).toContain('>−</tspan>');
  });
  it('hides ordinary bonded carbon, omits H0 and escapes label strings',()=>{
    expect(atomLabels(fixture())).toHaveLength(0);const sketch=fixture();sketch.atoms[0].element='<N&';sketch.atoms[0].hydrogens=0;
    expect(atomLabels(sketch)[0].parts).toEqual([{text:'<N&'}]);expect(toSvg(sketch)).toContain('&lt;N&amp;');expect(toSvg(sketch)).not.toContain('<N&');
  });
  it('keeps short labelled bonds from reversing their endpoints',()=>{
    const sketch=fixture('up');sketch.atoms[0].element='N';sketch.atoms[1].element='O';sketch.atoms[1].x=10;
    const line=bondLines(sketch)[0];expect(line.from.x).toBeLessThan(line.to.x);
  });
});
