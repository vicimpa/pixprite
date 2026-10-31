/** Real installed system-WebView cadence under native resize, using an isolated profile. */
import { callDesktop } from '../desktop/connection';
import { resolve } from 'node:path';
import { release } from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=resolve(import.meta.dir,'..');
const dir=await mkdtemp(join(tmpdir(),'pixprite-frame-pacing-'));
const connection=join(dir,'connection.json');
const label=process.argv[2]||'display';
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Expected a simple report label');
const child=Bun.spawn([`${root}/dist/desktop/pixprite${process.platform==='win32'?'.exe':''}`],{env:{...process.env,PIXPRITE_USER_DATA:dir,PIXPRITE_CONNECTION_FILE:connection,PIXPRITE_DISABLE_UPDATES:'1',...(process.env.PIXPRITE_WEBVIEW_FPS?{PIXPRITE_WEBVIEW_FPS:process.env.PIXPRITE_WEBVIEW_FPS}:{})},stdout:'ignore',stderr:'inherit'});
const call=(method:string,params?:Record<string,unknown>)=>callDesktop({method,params},connection) as Promise<any>;
const result:any={label,profile:dir,platform:process.platform,arch:process.arch,osVersion:release()};
try{
 for(let i=0;i<200;i++){try{await call('documents');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 await call('create',{width:64,height:64,name:'Frame pacing'}); const docs=await call('documents'); await call('select',{id:docs.active});
 await new Promise(r=>setTimeout(r,500));
 result.native=await call('desktop_info');
 result.idle=await call('performance',{durationMs:2000});
 const sample=call('performance',{durationMs:2500});
 const writes: number[]=[];
 const start=performance.now();let n=0;
 while(performance.now()-start<2000){const t=performance.now();await call('window_action',{action:'resize',width:1280+(n%30)*2,height:850+(n%20)});writes.push(performance.now()-t);n++;await new Promise(r=>setTimeout(r,8));}
 result.resize={...(await sample), nativeRequests:n, requestLatencyMs:writes};
 await call('window_action',{action:'resize',width:1280,height:900});
 await mkdir(`${root}/dist/reports/benchmarks/interaction`,{recursive:true});
 await writeFile(`${root}/dist/reports/benchmarks/interaction/${result.label}.json`,JSON.stringify(result,null,2));
 for(const [key,v] of Object.entries(result))if(typeof v==='object'&&v&&'intervalMs' in v){const s=v as any;console.log(key,JSON.stringify({...s,intervalMs:{...s.intervalMs,raw:undefined},requestLatencyMs:undefined}));}
}finally{await call('shutdown').catch(()=>{});const kill=setTimeout(()=>child.kill(),3000);await child.exited;clearTimeout(kill);}
