export const BLE_SERVICE='6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const BLE_TX='6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export function checksum(text){let hash=0x811c9dc5;for(const byte of new TextEncoder().encode(text))hash=Math.imul(hash^byte,0x01000193)>>>0;return hash.toString(16).padStart(8,'0');}
// Each report is framed before BLE fragments it: @sequence:fnv1a32:CSV\n.
// Checksum and sequence distinguish BLE delivery problems from LoRa packet gaps.
export class BleFramer {
  constructor(onCSV,onError){this.onCSV=onCSV;this.onError=onError;this.buffer='';this.last=null;this.missing=0;}
  feed(text){this.buffer+=text;let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i).replace(/\r$/,'');this.buffer=this.buffer.slice(i+1);const match=/^@(\d+):([0-9a-f]{8}):(.*)$/.exec(line);if(!match){this.onError('Rejected damaged BLE frame');continue;}const seq=Number(match[1]);if(!Number.isInteger(seq)||seq>0xffffffff||checksum(match[3])!==match[2]){this.onError('Rejected BLE checksum mismatch');continue;}let gap=0;if(this.last!==null){const diff=(seq-this.last)>>>0;if(diff===0)continue;if(diff>0x7fffffff){this.onError('Rejected out-of-order BLE frame; reconnect after a device restart');continue;}gap=diff-1;}try{this.onCSV(match[3],seq,gap);}catch(e){this.onError('Rejected BLE CSV: '+e.message);continue;}this.last=seq;this.missing+=gap;if(gap)this.onError(`BLE delivery gap: ${gap} reports missing (${this.missing} total). Check onboard SD for complete capture.`);}if(this.buffer.length>4096){this.buffer='';this.onError('Discarded oversized BLE frame');}}
  reset(){this.buffer='';this.last=null;this.missing=0;}
}
