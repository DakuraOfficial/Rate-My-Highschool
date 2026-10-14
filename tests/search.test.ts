import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDirectory, type School } from '../app/lib/search.ts';

const schools = [
  {id:'010000000001',name:'Lincoln High School',city:'Chicago',state:'IL',zip:'06001',type:'Regular',charter:false},
  {id:'020000000001',name:'Lincoln High School',city:'Portland',state:'ME',zip:'04001',type:'Regular',charter:true},
  {id:'030000000001',name:'École Central',city:'Chicago',state:'IL',zip:'60601',type:'Alternative',charter:false},
] as School[];

test('combines name search and physical state filter without losing duplicate names',()=>{
  assert.deepEqual(searchDirectory(schools,{q:'lincoln',state:'ME'}).items.map(s=>s.id),['020000000001']);
});
test('finds accented names and preserves leading-zero ZIP searches',()=>{
  assert.equal(searchDirectory(schools,{q:'ecole'}).items[0]?.id,'030000000001');
  assert.equal(searchDirectory(schools,{q:'040'}).items[0]?.id,'020000000001');
});
test('charter selection includes charter schools independently of school type',()=>{
  assert.equal(searchDirectory(schools,{type:'Charter'}).items[0]?.id,'020000000001');
});
test('ZIP searches match prefixes and never unrelated interior ZIP digits',()=>{
  assert.equal(searchDirectory(schools,{q:'001'}).total,0);
  assert.equal(searchDirectory(schools,{q:'060'}).items[0]?.id,'010000000001');
});
test('clamps an out-of-range page and returns a genuine empty result',()=>{
  const page=searchDirectory(schools,{page:500,pageSize:2});
  assert.equal(page.page,2); assert.equal(page.items.length,1); assert.equal(page.total,3);
  assert.deepEqual(searchDirectory(schools,{q:'zzzz'}).items,[]);
});
