import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
for(const file of readdirSync(directory).filter(name=>name.endsWith('.test.mjs')).sort()){
  const result=spawnSync(process.execPath,[join(directory,file)],{cwd:directory,stdio:'inherit'});
  if(result.error){console.error(result.error.message);process.exit(1);}
  if(result.status!==0)process.exit(result.status||1);
}
console.log('All project test suites passed.');
