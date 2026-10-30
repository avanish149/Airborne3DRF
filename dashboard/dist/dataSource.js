import {BLE_SERVICE,BLE_TX,BleFramer} from './bleProtocol.js';
export const HEADER=['Timestamp_ms','Latitude','Longitude','Altitude_m','RSSI_dBm','SNR_dB','Packet_ID'];
export const PAYLOAD_HEADER='ms,rx_ok,beacon_ctr,tx_dbm,rssi_dbm,rssi_avg,rssi_std,snr_db,noise_floor_dbm,freq_err_hz,fade_margin_db,path_loss_db,gap_ms,lost,loss_pct,score_rssi,score_snr,score_pdr,score,level,lat,lon,alt_m'.split(',');
export function normalizePayload(values,line=0){
  if(values.length!==PAYLOAD_HEADER.length)throw Error(`Payload row ${line}: expected 23 columns.`);
  const raw=Object.fromEntries(PAYLOAD_HEADER.map((k,i)=>[k,values[i]]));
  for(const k of PAYLOAD_HEADER.filter(k=>k!=='level')){if(String(raw[k]).trim()===''||!Number.isFinite(+raw[k]))throw Error(`Payload row ${line}: invalid ${k}`);raw[k]=+raw[k];}
  if(![0,1].includes(raw.rx_ok)||!Number.isSafeInteger(raw.ms)||raw.ms<0||!Number.isSafeInteger(raw.beacon_ctr)||raw.beacon_ctr < (raw.rx_ok?0:-1)||Math.abs(raw.lat)>90||Math.abs(raw.lon)>180||!Number.isInteger(raw.lost)||raw.lost<0||raw.loss_pct<0||raw.loss_pct>100||['score','score_rssi','score_snr','score_pdr'].some(k=>raw[k]<0||raw[k]>100))throw Error(`Payload row ${line}: invalid flag, counter, coordinates, loss or score.`);
  return {...raw,Timestamp_ms:raw.ms,Latitude:raw.lat,Longitude:raw.lon,Altitude_m:raw.alt_m,RSSI_dBm:raw.rx_ok?raw.rssi_dbm:null,SNR_dB:raw.rx_ok?raw.snr_db:null,Packet_ID:raw.beacon_ctr,received:!!raw.rx_ok,source:'payload-v2',positionSource:'simulated'};
}
export function parseCSV(text){
  const saved=Papa.parse(text.trim(),{header:true,skipEmptyLines:'greedy'});
  if(saved.meta.fields?.includes('Session_ID')&&HEADER.every(k=>saved.meta.fields.includes(k))){
    if(saved.errors.length)throw Error(saved.errors[0].message);
    if(!saved.data.length||saved.data.length>30000)throw Error('Use a saved CSV with 1–30,000 rows; split larger captures for visualization.');
    return saved.data.map((r,i)=>{if(r.Data_Source==='payload-v2')return {...normalizePayload(PAYLOAD_HEADER.map(k=>r[k]),i+2),positionSource:r.Position_Source||'simulated'};const clean={};for(const k of HEADER){if(String(r[k]??'').trim()===''||!Number.isFinite(+r[k]))throw Error('Invalid saved survey field: '+k);clean[k]=+r[k];}if(Math.abs(clean.Latitude)>90||Math.abs(clean.Longitude)>180||!Number.isSafeInteger(clean.Packet_ID)||clean.Packet_ID<0||clean.Timestamp_ms<0)throw Error('Invalid saved survey coordinates/counter');return {...clean,positionSource:r.Position_Source,source:r.Data_Source};});
  }

  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(!lines.some(l=>l===PAYLOAD_HEADER.join(',')))return parseLegacyCSV(text);
  const result=[];let started=false;
  for(let i=0;i<lines.length;i++){const line=lines[i];if(line===PAYLOAD_HEADER.join(',')){started=true;continue;}if(!started||!/^\d+,/.test(line))continue;const p=Papa.parse(line);if(p.errors.length)throw Error(`Payload row ${i+1}: malformed CSV`);result.push(normalizePayload(p.data[0],i+1));}
  if(!result.length||result.length>30000)throw Error('Use a CSV with 1–30,000 payload rows. Enable PRINT_CSV in firmware.');return result;
}
export function packetStats(rows){
  let last=null,lost=0,received=0,resets=0;for(const r of rows){if(r.received===false)continue;const id=r.Packet_ID;if(last!==null&&id===last)continue;if(last!==null&&id<last)resets++;else if(last!==null)lost+=Math.max(0,id-last-1);received++;last=id;}
  return {lost,received,resets,percent:received+lost?100*lost/(received+lost):null};
}
export function grid(samples,res){
  const good=samples.filter(s=>s.received!==false);if(good.length)return interpolateGrid(good,res);
  return {vox:[],min:['x','y','z'].map(k=>Math.min(...samples.map(s=>s[k]))),max:['x','y','z'].map(k=>Math.max(...samples.map(s=>s[k])))};
}
// Both transports emit normalized payload rows; UI and voxel code do not parse serial framing.
export class PayloadStream {
  constructor(onRow,onStatus){this.onRow=onRow;this.onStatus=onStatus;this.buffer='';this.bad=0;this.stopping=false;}
  feed(chunk){this.buffer+=chunk;let i;while((i=this.buffer.indexOf('\n'))>=0){let line=this.buffer.slice(0,i).trim();this.buffer=this.buffer.slice(i+1);if(!/^\d+,/.test(line))continue;try{this.onRow(normalizePayload(line.split(',')));}catch(e){this.onStatus('Rejected row: '+e.message);this.bad++;}}if(this.buffer.length>8192){this.buffer='';this.onStatus('Discarded oversized serial line.');}}
  async connectSerial(){if(!navigator.serial)throw Error('Web Serial requires a supported Chromium browser in a secure context. Use CSV upload here.');this.stopping=false;this.port=await navigator.serial.requestPort();await this.port.open({baudRate:115200});this.onStatus('Connected · serial 115200 baud');this.reader=this.port.readable.getReader();this.readTask=(async()=>{const decoder=new TextDecoder();try{while(!this.stopping){const {value,done}=await this.reader.read();if(done)break;this.feed(decoder.decode(value,{stream:true}));}}catch(e){if(!this.stopping)this.onStatus('Serial error: '+e.message);}finally{this.reader.releaseLock();this.reader=null;try{await this.port.close();}catch{}this.port=null;this.onStatus('Disconnected');}})();}
  connectSocket(url){if(!/^wss:\/\//i.test(url))throw Error('Use a secure wss:// endpoint streaming payload CSV text.');this.socket=new WebSocket(url);this.socket.onopen=()=>this.onStatus('Connected · WebSocket');this.socket.onmessage=e=>{if(typeof e.data==='string')this.feed(e.data.endsWith('\n')?e.data:e.data+'\n');else this.onStatus('Expected CSV text, received binary data.');};this.socket.onerror=()=>this.onStatus('WebSocket connection failed');this.socket.onclose=()=>this.onStatus('Disconnected');}
  async connectBluetooth(){
    if(!globalThis.isSecureContext)throw Error('Bluetooth requires HTTPS or the localhost dashboard.');
    if(!navigator.bluetooth)throw Error('Web Bluetooth is unavailable here. Open the local dashboard in Chrome or Edge.');
    this.stopping=false;this.bleDecoder=new TextDecoder();
    this.bleFramer=new BleFramer((csv,sequence,gap)=>{const row=normalizePayload(csv.split(','));this.onRow({...row,bleSequence:sequence,bleGapBefore:gap});},this.onStatus);
    const device=await navigator.bluetooth.requestDevice({filters:[{services:[BLE_SERVICE]}]});
    if(this.stopping)throw Error('Bluetooth connection cancelled.');this.bleDevice=device;
    this.bleDisconnected=()=>{this.bleFramer.reset();this.onStatus('Bluetooth disconnected · saved CSV retained. Click Connect Bluetooth to reconnect.');};
    device.addEventListener('gattserverdisconnected',this.bleDisconnected);
    try{
      const server=await device.gatt.connect();if(this.stopping)throw Error('Bluetooth connection cancelled.');
      const service=await server.getPrimaryService(BLE_SERVICE);if(this.stopping)throw Error('Bluetooth connection cancelled.');
      this.bleCharacteristic=await service.getCharacteristic(BLE_TX);if(this.stopping)throw Error('Bluetooth connection cancelled.');
      this.bleChanged=event=>this.bleFramer.feed(this.bleDecoder.decode(event.target.value,{stream:true}));
      this.bleCharacteristic.addEventListener('characteristicvaluechanged',this.bleChanged);
      await this.bleCharacteristic.startNotifications();if(this.stopping)throw Error('Bluetooth connection cancelled.');
      this.onStatus('Connected · Bluetooth LE · '+(device.name||'RF payload'));
    }catch(e){await this.disconnect();throw e;}
  }
  async disconnect(){this.stopping=true;
    if(this.bleCharacteristic){this.bleCharacteristic.removeEventListener('characteristicvaluechanged',this.bleChanged);try{await this.bleCharacteristic.stopNotifications();}catch{}this.bleCharacteristic=null;}
    if(this.bleDevice){this.bleDevice.removeEventListener('gattserverdisconnected',this.bleDisconnected);if(this.bleDevice.gatt.connected)this.bleDevice.gatt.disconnect();this.bleDevice=null;}
    this.bleFramer?.reset();
if(this.reader)await this.reader.cancel();if(this.readTask)await this.readTask;this.socket?.close();this.socket=null;this.buffer='';}
}
function parseLegacyCSV(text){const p=Papa.parse(text.trim(),{header:true,skipEmptyLines:'greedy'});if(p.errors.length)throw Error(p.errors[0].message);if(p.meta.fields?.join(',')!==HEADER.join(','))throw Error('Expected exact header: '+HEADER.join(','));if(!p.data.length||p.data.length>30000)throw Error('Use a CSV with 1–30,000 samples.');return p.data.map((r,i)=>{for(const k of HEADER){if(String(r[k]??'').trim()===''||!Number.isFinite(+r[k]))throw Error(`Row ${i+2}: invalid ${k}`);r[k]=+r[k];}if(Math.abs(r.Latitude)>90||Math.abs(r.Longitude)>180||!Number.isSafeInteger(r.Packet_ID)||r.Packet_ID<0||r.Timestamp_ms<0)throw Error(`Row ${i+2}: invalid coordinates, timestamp, or packet ID`);return r;}).sort((a,b)=>a.Timestamp_ms-b.Timestamp_ms);}
export function localize(rows,lat,lon){return rows.map(r=>({...r,x:(r.Longitude-lon)*111320*Math.cos(lat*Math.PI/180),y:(r.Latitude-lat)*111320,z:r.Altitude_m}));}
function legacyPacketStats(rows){const ids=[...new Set(rows.map(r=>r.Packet_ID))].sort((a,b)=>a-b);let lost=0;for(let i=1;i<ids.length;i++)lost+=Math.max(0,ids[i]-ids[i-1]-1);return {lost,percent:100*lost/(ids.length+lost)};}
export function demo(){let rows=[],id=1000,t=0,seed=42;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};for(let z=1;z<=8;z++)for(let j=0;j<=15;j++)for(let k=0;k<=20;k++){let x=j%2?20-k:k,y=z%2?15-j:j;const d=Math.max(1,Math.hypot(x,y,z));const blob=(a,b,c,s)=>Math.exp(-((x-a)**2+(y-b)**2+(z-c)**2)/s);const rssi=-46-20*Math.log10(d)-35*blob(13,9,5,15)-27*blob(6,5,3,9)-16*blob(17,3,7,6)+(rand()-.5)*7;t+=100;id++;if(rssi<-96&&rand()<.28)continue;rows.push({Timestamp_ms:t,Latitude:12.971598+y/111320,Longitude:77.594562+x/(111320*Math.cos(12.971598*Math.PI/180)),Altitude_m:z,RSSI_dBm:rssi,SNR_dB:Math.max(-20,Math.min(12,(rssi+100)/3+(rand()-.5)*3)),Packet_ID:id});}return rows;}
// Stage 3: serial/WebSocket adapters will emit this same validated row schema.
function interpolateGrid(samples,res){const min=['x','y','z'].map(k=>Math.min(...samples.map(p=>p[k]))),max=['x','y','z'].map(k=>Math.max(...samples.map(p=>p[k])));const dims=max.map((v,i)=>Math.floor((v-min[i])/res)+1);if(dims.reduce((a,b)=>a*b,1)>14000)throw Error('Grid exceeds 14,000 voxels. Increase cell size.');const buckets=new Map(),key=(x,y,z)=>`${x},${y},${z}`;for(const p of samples){const a=[p.x,p.y,p.z].map((v,i)=>Math.floor((v-min[i])/res)),k=key(...a);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}const vox=[];for(let ix=0;ix<dims[0];ix++)for(let iy=0;iy<dims[1];iy++)for(let iz=0;iz<dims[2];iz++){const p={x:min[0]+ix*res,y:min[1]+iy*res,z:min[2]+iz*res};let near=[];for(let radius=1;radius<=3&&!near.length;radius++)for(let a=-radius;a<=radius;a++)for(let b=-radius;b<=radius;b++)for(let c=-radius;c<=radius;c++)near.push(...(buckets.get(key(ix+a,iy+b,iz+c))||[]));if(!near.length)continue;near=near.map(s=>({s,d:(s.x-p.x)**2+(s.y-p.y)**2+(s.z-p.z)**2})).sort((a,b)=>a.d-b.d).slice(0,12);let w=0,r=0,n=0;for(const q of near){let weight=1/Math.max(.01,q.d);w+=weight;r+=q.s.RSSI_dBm*weight;n+=q.s.SNR_dB*weight;}vox.push({...p,RSSI_dBm:r/w,SNR_dB:n/w,Packet_ID:near[0].s.Packet_ID});}return {vox,min,max};}
