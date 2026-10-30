import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PayloadStream,PAYLOAD_HEADER} from '../dist/dataSource.js';
import {BLE_SERVICE,BLE_TX,checksum,BleFramer} from '../dist/bleProtocol.js';
import {createLogger} from '../local-server.mjs';
const Papa=createRequire(import.meta.url)('../dist/papaparse.min.cjs');
const fixture=Papa.parse(await fs.readFile(new URL('../payload-v2-example.csv',import.meta.url),'utf8'),{header:true,skipEmptyLines:true}).data;
const csv=i=>PAYLOAD_HEADER.map(k=>fixture[i][k]).join(','),frame=(seq,text)=>`@${seq}:${checksum(text)}:${text}\n`;
assert.equal(checksum('hello'),'4f9f2cab');
class Characteristic extends EventTarget {
  async startNotifications(){this.started=true;return this;}
  async stopNotifications(){this.started=false;return this;}
  send(text){const bytes=new TextEncoder().encode(text);this.value=new DataView(bytes.buffer);this.dispatchEvent(new Event('characteristicvaluechanged'));}
}
const characteristic=new Characteristic(),device=new EventTarget();device.name='RF-Payload-V2';device.gatt={connected:false,async connect(){this.connected=true;return this;},async getPrimaryService(uuid){assert.equal(uuid,BLE_SERVICE);return {async getCharacteristic(uuid){assert.equal(uuid,BLE_TX);return characteristic;}};},disconnect(){this.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{bluetooth:{async requestDevice(options){assert.deepEqual(options.filters,[{services:[BLE_SERVICE]}]);return device;}}}});Object.defineProperty(globalThis,'isSecureContext',{configurable:true,value:true});
const received=[],statuses=[],stream=new PayloadStream(r=>received.push(r),s=>statuses.push(s));await stream.connectBluetooth();assert(characteristic.started);assert(statuses.at(-1).includes('Connected'));
// Simulate 20-byte ATT fragments, split frames, coalesced frames, a corrupt frame and duplicates.
const first=frame(0,csv(0));for(let i=0;i<first.length;i+=20)characteristic.send(first.slice(i,i+20));assert.equal(received.length,1);
characteristic.send(frame(1,csv(1)).replace('EXCELLENT','EXCELLANT'));assert.equal(received.length,1);
characteristic.send(frame(2,csv(2))+frame(2,csv(2)));assert.equal(received.length,2);assert.equal(received[1].bleGapBefore,1);assert.equal(received[1].received,false);assert(statuses.some(s=>s.includes('checksum')));assert(statuses.some(s=>s.includes('delivery gap')));
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'rf-ble-test-')),server=createLogger({dataDir:tmp});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json();};
try{const session=await post('/api/logger/session',{});await post('/api/logger/append',{session:session.id,start:0,rows:received.map(row=>({row,transport:'bluetooth',at:new Date().toISOString()}))});const saved=Papa.parse(await fs.readFile(session.file,'utf8'),{header:true,skipEmptyLines:true}).data;assert.equal(saved.length,2);assert.equal(saved[0].Transport,'bluetooth');assert.equal(saved[1].BLE_Sequence,'2');assert.equal(saved[1].BLE_Gap_Before,'1');assert.equal(saved[1].RSSI_dBm,'');assert.equal(saved[0].Latitude,'10');}finally{await new Promise(resolve=>server.close(resolve));}
device.gatt.disconnect();assert(statuses.at(-1).includes('disconnected'));await stream.disconnect();characteristic.send(frame(3,csv(0)));assert.equal(received.length,2);assert(!characteristic.started);
const wrapped=[],framer=new BleFramer((line,seq,gap)=>wrapped.push({seq,gap}),()=>{});framer.feed(frame(0xffffffff,csv(0))+frame(0,csv(0)));assert.equal(wrapped[1].gap,0);
const header=await fs.readFile(new URL('../../firmware/payload/payload-ble/BleTelemetry.h',import.meta.url),'utf8');assert(header.includes(BLE_SERVICE));assert(header.includes(BLE_TX));assert(header.includes('0x811c9dc5u'));assert(header.includes('0x01000193u'));
console.log('PASS: mocked browser BLE connection, service/characteristic contract, notification fragmentation, checksum rejection, delivery gaps, duplicate suppression, sequence wrap, disconnect cleanup, BLE-to-CSV metadata. No physical device used.');
