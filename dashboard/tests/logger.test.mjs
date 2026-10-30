import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createLogger,CSV_FIELDS} from '../local-server.mjs';
import {PAYLOAD_HEADER,normalizePayload,PayloadStream,parseCSV} from '../dist/dataSource.js';
const Papa=createRequire(import.meta.url)('../dist/papaparse.min.cjs');
globalThis.Papa=Papa;
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rf-csv-test-'));
let server=createLogger({dataDir:directory});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let base=`http://127.0.0.1:${server.address().port}`;
const post=async(route,body,origin)=>{const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
const fixture=Papa.parse(await fs.readFile(new URL('../payload-v2-example.csv',import.meta.url),'utf8'),{header:true,skipEmptyLines:true}).data;
try{
  const {body:s}=await post('/api/logger/session',{});const entries=[];const stream=new PayloadStream(row=>entries.push({row,transport:'serial',at:'2026-10-30T10:00:00Z'}),()=>{});
  for(const record of fixture)stream.feed(PAYLOAD_HEADER.map(k=>record[k]).join(',')+'\n');assert.equal(entries.length,6);
  const batch={session:s.id,start:0,rows:entries};let saved=await post('/api/logger/append',batch);assert.equal(saved.status,200);assert.equal(saved.body.saved,6);
  // Lost HTTP acknowledgements can safely retry the exact same sequence numbers.
  saved=await post('/api/logger/append',batch);assert.equal(saved.body.saved,6);
  const data=Papa.parse(await fs.readFile(s.file,'utf8'),{header:true,skipEmptyLines:true});assert.deepEqual(data.meta.fields,CSV_FIELDS);assert.equal(data.data.length,6);assert.equal(data.data[0].Latitude,'10');assert.equal(data.data[0].Longitude,'77');assert.equal(data.data[0].Transport,'serial');assert.equal(data.data[0].Position_Source,'simulated');assert.equal(data.data[2].RSSI_dBm,'');assert.equal(data.data[2].rssi_dbm,'-130');assert.equal(data.data[2].rx_ok,'0');assert.equal(data.data[0].score,'83');
  const reimported=parseCSV(await fs.readFile(s.file,'utf8'));assert.equal(reimported.length,6);assert.equal(reimported[0].Latitude,10);assert.equal(reimported[2].received,false);assert.equal(reimported[0].score,83);
  const forbidden=await post('/api/logger/append',batch,'https://unrelated.example');assert.equal(forbidden.status,403);
  const malformed=await post('/api/logger/append',{session:s.id,start:6,rows:[{row:{},transport:'serial',at:new Date().toISOString()}]});assert.equal(malformed.status,400);assert.equal(Papa.parse(await fs.readFile(s.file,'utf8'),{header:true,skipEmptyLines:true}).data.length,6);
  const missing=await post('/api/logger/append',{session:s.id,start:8,rows:[entries[0]]});assert.equal(missing.status,400);
  // Recover sequence numbers from the durable CSV after the server restarts.
  await new Promise(resolve=>server.close(resolve));server=createLogger({dataDir:directory});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
  saved=await post('/api/logger/append',{session:s.id,start:6,rows:[entries[0]]});assert.equal(saved.body.saved,7);
  const retry=await Promise.all([post('/api/logger/append',{session:s.id,start:7,rows:[entries[0]]}),post('/api/logger/append',{session:s.id,start:7,rows:[entries[0]]})]);assert(retry.every(r=>r.status===200));assert.equal(Papa.parse(await fs.readFile(s.file,'utf8'),{header:true,skipEmptyLines:true}).data.length,8);
  console.log('PASS: stream-to-CSV coordinates, all payload fields, timeout sentinels, retry deduplication, restart recovery, serialized concurrent writes, invalid row and origin rejection. Test data: '+directory);
}finally{await new Promise(resolve=>server.close(resolve));}
