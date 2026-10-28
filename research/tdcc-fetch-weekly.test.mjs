import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTDCC} from './tdcc-fetch-weekly.mjs';

const makeCSV=(date='20261022',len=150)=>{
  const header='資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%\n';
  const rows=[];
  for(let i=0;i<len;i++)for(const grade of [12,13,14,15,17,16,1,2]){
    rows.push([date,String(1000+i),grade,3,grade===17?100000:1000,grade===17?100:1].join(','));
  }
  return header+rows.join('\n')+'\n';
};
test('full TDCC CSV reports actual date, rows, covered symbols',()=>{
  const x=validateTDCC(makeCSV());
  assert.equal(x.date,'2026-10-22');
  assert.equal(x.symbols,150);
  assert.equal(x.rows,1200);
});
test('HTML response and invalid symbols cannot pass official-source validation',()=>{
  assert.throws(()=>validateTDCC('<html>Blocked</html>'),/full TDCC/);
  assert.throws(()=>validateTDCC(makeCSV('BAD_DATE')),/Invalid TDCC/);
  assert.throws(()=>validateTDCC(makeCSV('20261022',15)),/full TDCC/);
});
test('mixed week dates rejected, never label future as current',()=>{
  const str=makeCSV().replace('20261022,1001,12','20261015,1001,12');
  assert.throws(()=>validateTDCC(str),/conflicting dates/);
});
