import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {HEADER,PAYLOAD_HEADER,normalizePayload} from './dist/dataSource.js';
const Papa=createRequire(import.meta.url)('./dist/papaparse.min.cjs');
const root=path.dirname(fileURLToPath(import.meta.url));
export const CSV_FIELDS=['Session_ID','Row_ID','Received_at_UTC','Data_Source','Transport','Position_Source','BLE_Sequence','BLE_Gap_Before',...HEADER,...PAYLOAD_HEADER];
const escape=v=>{const s=v===null||v===undefined?'':String(v);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
const csv=values=>values.map(escape).join(',')+'\r\n';
export function createLogger({dataDir=path.resolve(root,'../data'),staticDir=path.join(root,'dist')}={}){
  const sessions=new Map();
  async function session(id){if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid session');if(sessions.has(id))return sessions.get(id);const file=path.join(dataDir,`survey_${id}.csv`),body=await fs.readFile(file,'utf8'),parsed=Papa.parse(body,{header:true,skipEmptyLines:true});if(parsed.errors.length||![CSV_FIELDS.join(','),CSV_FIELDS.filter(k=>!k.startsWith('BLE_')).join(',')].includes(parsed.meta.fields.join(',')))throw Error('CSV recovery failed; preserve the file and start a new session.');const state={id,file,fields:parsed.meta.fields,next:parsed.data.length,tail:Promise.resolve()};sessions.set(id,state);return state;}
  return http.createServer(async(req,res)=>{
    const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try{
      const expected=`127.0.0.1:${req.socket.localPort}`;if(![expected,`localhost:${req.socket.localPort}`].includes(req.headers.host))return json(403,{error:'Localhost only'});
      if(req.headers.origin&&!['http://'+expected,`http://localhost:${req.socket.localPort}`].includes(req.headers.origin))return json(403,{error:'Open the dashboard from this local server to save CSV.'});
      const url=new URL(req.url,'http://'+expected);
      if(req.method==='GET'&&url.pathname==='/api/logger/status')return json(200,{available:true,directory:dataDir});
      if(req.method==='POST'&&url.pathname.startsWith('/api/logger/')){
        if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'JSON required'});
        let body='',bytes=0;for await(const c of req){bytes+=c.length;if(bytes>2*1024*1024)return json(413,{error:'Batch too large'});body+=c;}
        const input=JSON.parse(body);
        if(url.pathname==='/api/logger/session'){
          await fs.mkdir(dataDir,{recursive:true});const id=randomUUID(),file=path.join(dataDir,`survey_${id}.csv`);const handle=await fs.open(file,'wx');try{await handle.writeFile(csv(CSV_FIELDS));await handle.sync();}finally{await handle.close();}sessions.set(id,{id,file,fields:CSV_FIELDS,next:0,tail:Promise.resolve()});return json(201,{id,file,saved:0});
        }
        if(url.pathname==='/api/logger/append'){
          const s=await session(input.session);if(!Array.isArray(input.rows)||!input.rows.length||input.rows.length>500||!Number.isSafeInteger(input.start)||input.start<0)return json(400,{error:'Invalid batch'});
          const operation=s.tail.then(async()=>{
            if(input.start>s.next)throw Error('Out-of-order batch; retry pending rows first.');const skip=Math.max(0,s.next-input.start),fresh=input.rows.slice(skip);
            const lines=fresh.map((entry,i)=>{
              let r=entry.row;const bleSequence=r?.bleSequence,bleGap=r?.bleGapBefore;if(entry.transport==='bluetooth'&&(!Number.isInteger(bleSequence)||bleSequence<0||bleSequence>0xffffffff||!Number.isInteger(bleGap)||bleGap<0||bleGap>0xffffffff))throw Error('Missing or invalid BLE delivery metadata');if(!r||!['serial','websocket','bluetooth','csv-import','demo'].includes(entry.transport))throw Error('Invalid row transport');
              if(r.source==='payload-v2'){r=normalizePayload(PAYLOAD_HEADER.map(k=>r[k]));if(!['EXCELLENT','GOOD','FAIR','POOR','DEAD ZONE'].includes(r.level))throw Error('Invalid quality label');}
              else{for(const k of HEADER)if(r[k]===null||r[k]===''||!Number.isFinite(r[k]))throw Error('Invalid survey row');if(Math.abs(r.Latitude)>90||Math.abs(r.Longitude)>180||!Number.isSafeInteger(r.Packet_ID)||r.Packet_ID<0||r.Timestamp_ms<0)throw Error('Invalid survey coordinates/counter');}
              const stamp=new Date(entry.at);if(Number.isNaN(stamp.getTime()))throw Error('Invalid capture timestamp');
              const metadata={BLE_Sequence:bleSequence,BLE_Gap_Before:bleGap,Session_ID:s.id,Row_ID:s.next+i,Received_at_UTC:stamp.toISOString(),Data_Source:r.source|| (entry.transport==='demo'?'demo':'survey-csv'),Transport:entry.transport,Position_Source:r.positionSource||(entry.transport==='demo'?'simulated':'unspecified')};return csv(s.fields.map(k=>metadata[k]??r[k]));
            }).join('');
            if(lines){const handle=await fs.open(s.file,'a');try{await handle.writeFile(lines);await handle.sync();}finally{await handle.close();}s.next+=fresh.length;}return {file:s.file,saved:s.next};
          });s.tail=operation.catch(()=>{});return json(200,await operation);
        }
        return json(404,{error:'Unknown logger route'});
      }
      if(req.method!=='GET')return json(405,{error:'Method not allowed'});
      const rel=decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1)),file=path.resolve(staticDir,rel);if(!file.startsWith(path.resolve(staticDir)+path.sep))return json(403,{error:'Invalid path'});
      const contents=await fs.readFile(file);const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ino':'text/plain'}[path.extname(file)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(contents);
    }catch(e){json(e.code==='ENOENT'?404:400,{error:e.message});}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.RF_LOGGER_PORT||4174),server=createLogger();server.on('error',e=>{console.error(e.message);process.exit(1);});server.listen(port,'127.0.0.1',()=>console.log(`RF logger: http://127.0.0.1:${port}\nCSV folder: ${path.resolve(root,'../data')}`));
}
