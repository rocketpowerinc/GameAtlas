import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu, nativeImage } from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {ArtworkScan} from './artwork-scan';
import { LibraryStore } from './store';
import { PreferencesStore } from './preferences';
import { DesktopUpdater } from './updater';
import { writeBackup, readBackup, missingArtwork } from './backup';
import { searchGames, gameDetails } from '../lib/game-lookup-server';
protocol.registerSchemesAsPrivileged([{scheme:'atlas',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const smoke=process.argv.includes('--smoke-test');
if(smoke)app.setPath('userData',join(app.getPath('temp'),'gameatlas-smoke-'+process.pid));
if(!app.requestSingleInstanceLock())app.quit();
let window:BrowserWindow; let store:LibraryStore;let preferences:PreferencesStore;
let backupBusy=false;let restoring=false;
const root=join(__dirname,'../dist');
const artHosts=['ignimgs.com','ign.com','wikimedia.org','steamstatic.com','steamcdn-a.akamaihd.net'];
const safeArt=(raw:string)=>{try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&artHosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}};
const inflight=new Map<string,Promise<Response>>();
async function artwork(raw:string):Promise<Response>{
 if(restoring)throw Error('Artwork is being restored.');
 const local=/^https:\/\/local-art\.gameatlas\.invalid\/[a-f0-9]{64}$/.test(raw);
 if(!local&&!safeArt(raw))return new Response('Unsupported artwork source',{status:400});
 const key=createHash('sha256').update(raw).digest('hex'); const path=join(app.getPath('userData'),'artwork',key);
 if(existsSync(path)&&existsSync(path+'.type')&&statSync(path).size>0)return new Response(readFileSync(path),{headers:{'Content-Type':readFileSync(path+'.type','utf8')}});
 if(local)throw Error('Choose the local image again or restore a complete backup.');
 if(inflight.has(key))return (await inflight.get(key)!).clone();
 const task=(async()=>{
  let url=raw; let response:Response|undefined;
  for(let n=0;n<5;n++){response=await fetch(url,{headers:{'User-Agent':'GameAtlas/1.4 (desktop game artwork)','Accept':'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8'},redirect:'manual',signal:AbortSignal.timeout(15000)});
   if(response.status>=300&&response.status<400){url=new URL(response.headers.get('location')||'',url).href;if(!safeArt(url))throw new Error('Unsupported redirect');continue;}break;}
  if(!response?.ok)throw new Error(response?.status===429?'The image source is limiting downloads. Please retry in a few minutes.':response?.status===403?'The image source refused the download.':'The image source is unavailable (HTTP '+response?.status+').');
  const type=response.headers.get('content-type')?.split(';')[0]||'';
  if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type))throw new Error('Unsupported image');
  const reader=response.body!.getReader(); const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10_000_000){await reader.cancel();throw new Error('Image too large');}chunks.push(value);}
  const buffer=Buffer.concat(chunks);if(['image/png','image/jpeg'].includes(type)&&nativeImage.createFromBuffer(buffer).isEmpty())throw Error('Artwork is not a readable image.');writeFileSync(path+'.type',type);writeFileSync(path+'.tmp',buffer);renameSync(path+'.tmp',path);
  return new Response(buffer,{headers:{'Content-Type':type}});
 })();
 inflight.set(key,task);try{return (await task).clone();}finally{inflight.delete(key);}
}
function trusted(event:Electron.IpcMainInvokeEvent){if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!event.senderFrame.url.startsWith('atlas://app/'))throw new Error('Untrusted window');}
app.whenReady().then(async()=>{
 app.setAppUserModelId('com.rocketpowerinc.gameatlas');
 mkdirSync(join(app.getPath('userData'),'artwork'),{recursive:true});
 const existing=existsSync(join(app.getPath('userData'),'library.sqlite'));
 store=new LibraryStore(app.getPath('userData'),join(__dirname,'../data/library.json'));
 preferences=new PreferencesStore(app.getPath('userData'),existing);
 const scan=new ArtworkScan(store,{
  cached:url=>{const path=join(store.directory,'artwork',createHash('sha256').update(url).digest('hex'));return existsSync(path)&&existsSync(path+'.type')&&statSync(path).size>0;},
  download:async url=>{const response=await artwork(url);if(!response.ok)throw Error('Artwork could not be downloaded.');},
  search:searchGames,details:gameDetails
 });
 ipcMain.handle('artwork-status',event=>{trusted(event);return scan.read();});
 ipcMain.handle('cancel-artwork-scan',event=>{trusted(event);scan.cancel();});
 ipcMain.handle('scan-artwork',async event=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  if(!preferences.read().setupComplete)throw Error('Finish setup first.');
  backupBusy=true;
  try{const result=await scan.run();if(result.added)preferences.run(store,'change');return {...result,error:result.error||preferences.error||undefined};}finally{backupBusy=false;}
 });
 ipcMain.handle('apply-artwork',async(event,id,url)=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  if(!preferences.read().setupComplete)throw Error('Finish setup first.');
  backupBusy=true;try{await scan.apply(id,url);preferences.run(store,'change');if(preferences.error)throw Error(preferences.error);}finally{backupBusy=false;}
 });
 ipcMain.handle('choose-artwork-file',async(event,id)=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  if(!preferences.read().setupComplete)throw Error('Finish setup first.');
  if(typeof id!=='string'||!store.read().games.some(g=>g.id===id))throw Error('Game no longer exists.');
  backupBusy=true;
  try{
   const selected=await dialog.showOpenDialog(window,{title:'Choose a game thumbnail',properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp','gif','avif']}]});
   if(selected.canceled||!selected.filePaths[0])return false;
   const path=selected.filePaths[0];if(statSync(path).size>10_000_000)throw Error('Choose an image smaller than 10 MB.');
   const image=nativeImage.createFromBuffer(readFileSync(path));if(image.isEmpty())throw Error('This file is not a readable image.');
   const size=image.getSize();const bytes=(Math.max(size.width,size.height)>1024?image.resize(size.width>=size.height?{width:1024}:{height:1024}):image).toPNG();
   const url='https://local-art.gameatlas.invalid/'+createHash('sha256').update(bytes).digest('hex');
   const key=createHash('sha256').update(url).digest('hex'),destination=join(store.directory,'artwork',key);
   writeFileSync(destination+'.type','image/png');writeFileSync(destination+'.tmp',bytes);renameSync(destination+'.tmp',destination);
   await scan.apply(id,url);preferences.run(store,'change');if(preferences.error)throw Error(preferences.error);return true;
  }finally{backupBusy=false;}
 });
 const updater=new DesktopUpdater(store,status=>window?.webContents.send('update-status',status));
 protocol.handle('atlas',async request=>{
  try{const url=new URL(request.url);
   if(url.hostname==='art')return await artwork(url.searchParams.get('url')||'');
   if(url.hostname!=='app')return new Response('',{status:404});
   const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
   if(!path.startsWith(root+sep))return new Response('',{status:403});
   return net.fetch(pathToFileURL(path).href);
  }catch{return new Response('Unavailable',{status:503});}
 });
 ipcMain.handle('request',async(event,path,method,body)=>{
  trusted(event);
  try{
   if(path==='/api/library'&&method==='GET')return {ok:true,data:store.read()};
   if(path==='/api/library'&&method==='PUT'){
    if(backupBusy)throw Error('Wait for the backup or restore to finish.');
    if(!preferences.read().setupComplete)throw Error('Finish setup before editing your library.');
    if(JSON.stringify(body.fields)!==JSON.stringify(store.read().fields))throw Error('Library properties cannot be added, removed, or changed.');
    const saved=store.save(body,false);preferences.run(store,'change');const warning=preferences.error;
    return {ok:true,data:saved,warning};
   }
   if(path==='/api/game-lookup'&&method==='POST'){
    if(JSON.stringify(body).length>3000)throw new Error('Search request too long.');
    if(body.action==='search'&&typeof body.query==='string'&&body.query.trim().length>=2&&body.query.length<=500)return {ok:true,data:await searchGames(body.query.trim())};
    const c=body.candidate;
    if(['details','artwork'].includes(body.action)&&c&&typeof c.name==='string'&&c.name.length<=300&&(c.wikiId||c.steamId)&&[c.wikiId,c.steamId].every(id=>id===undefined||Number.isSafeInteger(id)&&id>0)){
     const details=await gameDetails(c);if(body.action==='details')return {ok:true,data:details};
     const previews=[];let failure='No downloadable artwork was found for this match.';
     for(const url of [...new Set([details.coverUrl,...(details.coverUrls||[])].filter((u):u is string=>!!u))]){try{const r=await artwork(url);if(!r.ok)throw Error('This image source is not supported.');const bytes=Buffer.from(await r.arrayBuffer());previews.push({url,dataUrl:'data:'+r.headers.get('content-type')+';base64,'+bytes.toString('base64')});}catch(e){failure=e instanceof Error?e.message:String(e);}}
     if(!previews.length)throw Error(failure);return {ok:true,data:{previews}};
    }
   }
   throw new Error('Invalid request.');
  }catch(e){return {ok:false,data:{error:e instanceof Error?e.message:'Operation failed.'}};}
 });
 ipcMain.handle('export-backup',async event=>{
  trusted(event);if(backupBusy)throw Error('A backup or restore is already running.');
  backupBusy=true;
  try{
   const {filePath}=await dialog.showSaveDialog(window,{defaultPath:join(preferences.read().backupFolder,'gameatlas-backup-'+new Date().toISOString().slice(0,10)+'.gameatlas'),filters:[{name:'Complete GameAtlas backup',extensions:['gameatlas']}]});
   if(!filePath)return '';
   if(!filePath.toLowerCase().endsWith('.gameatlas'))throw Error('Save complete backups with the .gameatlas extension.');
   const pending=missingArtwork(store.read(),store.directory);
   // Four bounded downloads at a time; each URL is attempted once.
   let cursor=0;
   await Promise.all(Array.from({length:Math.min(4,pending.length)},async()=>{while(cursor<pending.length){const url=pending[cursor++];try{await artwork(url);}catch{}}}));
   const missing=missingArtwork(store.read(),store.directory);
   if(missing.length){
    const choice=await dialog.showMessageBox(window,{type:'warning',title:'Some thumbnails are unavailable',message:missing.length+' artwork links could not be downloaded.',detail:'All game properties and descriptions will be included. These missing image files cannot be restored offline from this backup. You can cancel and retry when the sources are available.',buttons:['Cancel','Save with missing thumbnails'],defaultId:0,cancelId:0});
    if(choice.response!==1)return '';
   }
   const result=writeBackup(store.db,store.directory,filePath);
   return 'Backup saved: '+result.games+' games and '+result.images+' image files.'+(result.missing.length?' '+result.missing.length+' thumbnails are missing.':' All linked thumbnails are included.');
  }finally{backupBusy=false;}
 });
 ipcMain.handle('restore-backup',async event=>{
  trusted(event);if(backupBusy)throw Error('A backup or restore is already running.');backupBusy=true;
  try{
   const {filePaths,canceled}=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'GameAtlas backups',extensions:['gameatlas','json']}]});
   if(canceled)return false;
   const backup=readBackup(filePaths[0]);
   const detail=backup.summary.legacy?'This older JSON backup contains no image files. Your existing cached images will be kept.':backup.summary.images+' image files will be restored.'+(backup.summary.missing.length?' '+backup.summary.missing.length+' linked thumbnails are missing from this backup.':'');
   const choice=await dialog.showMessageBox(window,{type:'warning',title:'Restore GameAtlas backup',message:'Replace your collection with '+backup.summary.games+' games?',detail:detail+' A complete safety backup of the current collection and cached images will be saved first.',buttons:['Cancel','Restore backup'],defaultId:0,cancelId:0});
   if(choice.response!==1)return false;
   restoring=true;await Promise.allSettled([...inflight.values()]);
   store.restore(backup);
   preferences.run(store,'change');if(preferences.error)await dialog.showMessageBox(window,{type:'warning',message:preferences.error});
   return true;
  }finally{restoring=false;backupBusy=false;}
 });
 ipcMain.handle('start-library',async event=>{
  trusted(event);if(preferences.read().setupComplete)throw Error('Setup is already complete.');if(backupBusy)throw Error('Wait for the current operation.');
  if(store.read().games.length){
   const choice=await dialog.showMessageBox(window,{type:'warning',message:'Start empty instead of keeping the imported library?',buttons:['Cancel','Start empty'],defaultId:0,cancelId:0});if(choice.response!==1)return false;
   backupBusy=true;restoring=true;
   try{await Promise.allSettled([...inflight.values()]);const library=JSON.parse(readFileSync(join(__dirname,'../data/library.json'),'utf8'));
    store.restore({library,artwork:[],summary:{games:0,images:0,missing:[],createdAt:'',legacy:false}});
   }finally{restoring=false;backupBusy=false;}
  }
  return true;
 });
 ipcMain.handle('update-status',event=>{trusted(event);return updater.status;});
 ipcMain.handle('check-updates',async event=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  backupBusy=true;try{return await updater.check();}finally{if(updater.status.state!=='installing')backupBusy=false;}
 });
 ipcMain.handle('dismiss-update',event=>{trusted(event);return updater.dismiss();});
 ipcMain.handle('install-update',async(event,version)=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  if(typeof version!=='string')throw Error('Invalid update selection.');
  backupBusy=true;try{return await updater.install(version);}finally{if(updater.status.state!=='installing')backupBusy=false;}
 });
 ipcMain.handle('get-settings',event=>{trusted(event);return preferences.read();});
 ipcMain.handle('save-settings',(event,input,complete)=>{trusted(event);if(backupBusy)throw Error('Wait for backup or restore to finish.');if(typeof complete!=='boolean')throw Error('Invalid settings.');
  preferences.configure(input,complete);preferences.run(store,'change');return preferences.read();
 });
 ipcMain.handle('backup-folder',async event=>{trusted(event);const result=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory'],defaultPath:preferences.read().backupFolder});return result.canceled?'':result.filePaths[0];});
 ipcMain.handle('open-backups',async event=>{trusted(event);const folder=preferences.read().backupFolder;mkdirSync(folder,{recursive:true});return shell.openPath(folder);});
 Menu.setApplicationMenu(null);
 window=new BrowserWindow({width:1440,height:960,minWidth:900,minHeight:650,show:!smoke,title:'GameAtlas',icon:join(__dirname,'../public/icon-512.png'),backgroundColor:'#101216',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,offscreen:smoke}});
 window.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))void shell.openExternal(url);return {action:'deny'};});
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('atlas://app/')){event.preventDefault();if(/^https?:\/\//i.test(url))void shell.openExternal(url);}});
 window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 app.on('second-instance',()=>{if(window.isMinimized())window.restore();window.focus();});
 await window.loadURL('atlas://app/');
 preferences.run(store,'startup');
 const schedule=setInterval(()=>{if(!backupBusy)preferences.run(store,'timer');},60000);schedule.unref();
 // Warm the cache gradually; failures are retried when a game is displayed or on the next launch.
 if(!smoke){void(async()=>{for(const game of store.read().games){if(game.lookup?.coverUrl)try{await artwork(game.lookup.coverUrl);}catch{}}})();}
 if(smoke){
  try{
   await new Promise(r=>setTimeout(r,1500));
   mkdirSync(join(app.getPath('temp'),'gameatlas-verification'),{recursive:true});
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','welcome.png'),(await window.webContents.capturePage()).toPNG());
   await window.webContents.executeJavaScript(`(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,200));
    const lib=(await window.gameAtlas.request('/api/library','GET')).data;
    const marks=[...document.querySelectorAll('img.brand-mark')];
    if(marks.length<2||marks.some(img=>!img.complete||!img.naturalWidth))throw Error('Brand artwork failed to load');
    if(lib.games.length!==0)throw Error('Fresh install is not blank');
    if(!document.body.textContent.includes('Welcome to GameAtlas'))throw Error('Wizard missing');
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Start a new library')).click();await wait();
    const select=document.querySelector('#backup-schedule');
    const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(select,'manual');select.dispatchEvent(new Event('change',{bubbles:true}));await wait();
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Finish setup')).click();await wait();
    if(!(await window.gameAtlas.getSettings()).setupComplete)throw Error('Setup not saved');
    const saved=await window.gameAtlas.request('/api/library','PUT',{...lib,games:[{id:'test',values:{Title:'Test game',Ownership:['Physical'],Status:['Backlog'],Platform:['Switch'],Genre:['Adventure'],Score:8.5}}]});
    if(!saved.ok)throw Error('Save failed');
    const rejected=await window.gameAtlas.request('/api/library','PUT',{...saved.data,fields:[]});
    if(rejected.ok)throw Error('Property editing was accepted');
    document.querySelector('[aria-label="Refresh library"]').click();await wait();
    if(!document.querySelector('.game-card'))throw Error('Game card missing');
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Dashboard').click();await wait();
    if(!document.querySelector('.collection-dashboard')||!document.querySelector('[aria-label="Owned: 1 games"]')||!document.querySelector('[aria-label="Unplayed: 1 games"]'))throw Error('Dashboard totals are wrong');
    document.querySelector('[aria-label="Owned: 1 games"]').click();await wait();
    if(!document.querySelector('.dashboard-filter')||document.querySelectorAll('.game-card').length!==1)throw Error('Dashboard drill-down failed');
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Show all games').click();
    document.querySelector('[aria-label="Settings"]').click();await wait();
    if(document.body.textContent.includes('Properties & backups')||document.body.textContent.includes('Add property'))throw Error('Property controls remain');
   })()`);
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','settings.png'),(await window.webContents.capturePage()).toPNG());

   // Exercise the actual Settings scan/review controls with deterministic offline sources.
   const originalFetch=globalThis.fetch;
   globalThis.fetch=(async()=>Response.json({query:{search:[]},items:[]})) as typeof fetch;
   try{
    await window.webContents.executeJavaScript(`(async()=>{
     const pause=()=>new Promise(r=>setTimeout(r,100));
     [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Check for missing artwork')).click();
     for(let n=0;n<50&&!document.querySelector('.artwork-settings');n++)await pause();
     if(document.querySelector('.settings-editor')||document.querySelectorAll('[role="dialog"]').length!==1)throw Error('Settings remained open behind artwork window');
     const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Find artwork automatically'));
     for(let n=0;n<50&&button.disabled;n++)await pause();
     if(!button||button.disabled)throw Error('Artwork scan button unavailable');
     button.click();
     for(let n=0;n<100;n++){await pause();const s=await window.gameAtlas.getArtworkStatus();if(s.total===1&&!s.running)break;}
     const result=await window.gameAtlas.getArtworkStatus();
     if(result.total!==1||result.running||result.missing.length!==1)throw Error('Artwork scan/review failed');
    })()`);
   }finally{globalThis.fetch=originalFetch;}
   // A rejected primary cover must fall back to the other source before preview.
   globalThis.fetch=(async(input:any)=>{
    const url=String(input);
    if(url.includes('upload.wikimedia.org'))return new Response('Rate limited',{status:429});
    if(url.includes('steamstatic.com'))return new Response(readFileSync(join(__dirname,'../public/icon-512.png')),{headers:{'content-type':'image/png'}});
    if(url.includes('appdetails'))return Response.json({'2':{success:true,data:{type:'game',name:'Test game',header_image:'https://cdn.akamai.steamstatic.com/test.png'}}});
    if(url.includes('action=parse'))return Response.json({parse:{title:'Test game',text:{'*':'<table class="ib-video-game"><tr><td><img src="https://upload.wikimedia.org/test.jpg"></td></tr></table><p>Test description.</p>'}}});
    return Response.json({query:{search:[]},items:[]});
   }) as typeof fetch;
   const preview=await window.webContents.executeJavaScript("window.gameAtlas.request('/api/game-lookup','POST',{action:'artwork',candidate:{name:'Test game',wikiId:1,steamId:2}})");
   if(!preview.ok||preview.data.previews.length!==1||!preview.data.previews[0].url.includes('steamstatic.com')||!preview.data.previews[0].dataUrl.startsWith('data:image/png;base64,'))throw Error('Artwork preview fallback failed');
   dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[join(__dirname,'../public/icon-512.png')]})) as typeof dialog.showOpenDialog;
   await window.webContents.executeJavaScript(`(async()=>{
    const pause=()=>new Promise(r=>setTimeout(r,100));
    for(let n=0;n<50&&!document.querySelector('.artwork-missing-game');n++)await pause();

    document.querySelector('.artwork-missing-game').click();
    for(let n=0;n<50;n++){await pause();const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Choose image file'));if(b&&!b.disabled)break;}
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Choose image file')).click();
    for(let n=0;n<50;n++){await pause();if(!(await window.gameAtlas.getArtworkStatus()).missing.length)break;}
    if((await window.gameAtlas.getArtworkStatus()).missing.length)throw Error('Local thumbnail selection failed');
   })()`);
   globalThis.fetch=originalFetch;
   await new Promise(r=>setTimeout(r,300));
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','artwork-window.png'),(await window.webContents.capturePage()).toPNG());
   const selectedArt=store.read().games[0].lookup?.coverUrl;
   if(!selectedArt?.startsWith('https://local-art.gameatlas.invalid/'))throw Error('Local artwork was not saved');
   if(!(await artwork(selectedArt)).ok)throw Error('Local artwork does not render');
   const archivePath=join(app.getPath('temp'),'gameatlas-wizard-'+process.pid+'.gameatlas');
   dialog.showSaveDialog=(async()=>({canceled:false,filePath:archivePath})) as typeof dialog.showSaveDialog;
   dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[archivePath]})) as typeof dialog.showOpenDialog;
   dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as typeof dialog.showMessageBox;
   await window.webContents.executeJavaScript('window.gameAtlas.exportBackup()');
   store.save({...store.read(),games:[]},false);
   await window.webContents.executeJavaScript('window.gameAtlas.restoreBackup()');
   if(store.read().games.length!==1)throw Error('Restore failed');
   if(store.read().games[0].lookup?.coverUrl!==selectedArt||!(await artwork(selectedArt)).ok)throw Error('Selected artwork did not survive full backup/restore');
   // Exercise import from the first-run wizard separately from the start-empty path.
   store.save({...store.read(),games:[]},false);
   writeFileSync(join(store.directory,'settings.json'),JSON.stringify({...preferences.read(),setupComplete:false}));
   preferences=new PreferencesStore(store.directory,true);
   await window.loadURL('atlas://app/');
   await new Promise(r=>setTimeout(r,700));
   await window.webContents.executeJavaScript(`(async()=>{
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Import a GameAtlas library')).click();
    for(let n=0;n<30&&!document.querySelector('#backup-schedule');n++)await new Promise(r=>setTimeout(r,100));
    if(!document.querySelector('#backup-schedule'))throw Error('Import wizard did not reach preferences');
    if((await window.gameAtlas.request('/api/library','GET')).data.games.length!==1)throw Error('Wizard import lost the library');
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Finish setup')).click();
    await new Promise(r=>setTimeout(r,300));
    if(!(await window.gameAtlas.getSettings()).setupComplete)throw Error('Import setup did not persist');
   })()`);
   const realFetch=globalThis.fetch;
   globalThis.fetch=(async()=>Response.json({tag_name:'v'+app.getVersion(),draft:false,prerelease:false,assets:[]})) as typeof fetch;
   try{
    const current=await window.webContents.executeJavaScript('window.gameAtlas.checkUpdates()');if(current.state!=='current')throw Error('Check updates IPC failed');
   }finally{globalThis.fetch=realFetch;}
   const before=readdirSync(store.backupDir).filter(n=>n.startsWith('before-update-')).length;
   let launched=false,finished=false,downloads=0;
   const simulated=new DesktopUpdater(store,()=>{},{
    latest:async()=>({version:'99.0.0',url:'',size:1,digest:''}),
    download:async()=>{downloads++;return 'test-only-not-executed.exe';},
    launch:async()=>{if(readdirSync(store.backupDir).filter(n=>n.startsWith('before-update-')).length<=before)throw Error('Update safety backup missing');launched=true;},
    finish:()=>{finished=true;},packaged:()=>true
   });
   try{await simulated.install('99.0.0');throw Error('Install allowed without review');}catch(e){if(!(e instanceof Error)||!e.message.includes('review'))throw e;}
   if((await simulated.check()).state!=='available'||downloads||launched||finished)throw Error('Check installed without consent');
   simulated.dismiss();
   if(downloads||launched||finished)throw Error('Postponing installed the update');
   await simulated.check();
   try{await simulated.install('98.0.0');throw Error('Wrong release accepted');}catch(e){if(!(e instanceof Error)||!e.message.includes('review'))throw e;}
   if((await simulated.install('99.0.0')).state!=='installing'||downloads!==1||!launched||!finished)throw Error('Confirmed install failed');
   let networkCalls=0;
   globalThis.fetch=(async()=>{networkCalls++;return Response.json({tag_name:'v99.0.0',draft:false,prerelease:false,body:'Clearer artwork review and faster library browsing.',assets:[{id:42,name:'GameAtlas.Setup.99.0.0.exe',state:'uploaded',size:1,digest:'sha256:'+'a'.repeat(64)}]});}) as typeof fetch;
   try{
    await window.webContents.executeJavaScript(`(async()=>{
     const pause=()=>new Promise(r=>setTimeout(r,100));
     document.querySelector('[aria-label="Settings"]').click();
     await pause();
     const result=await window.gameAtlas.checkUpdates();
     if(result.state!=='available')throw Error('Release review not returned');
     for(let n=0;n<30&&!document.querySelector('.update-review');n++)await pause();
     const review=document.querySelector('.update-review');
     if(!review||!review.textContent.includes('Clearer artwork review')||!review.textContent.includes('relaunch automatically'))throw Error('Release notes or relaunch message missing');
     if(![...review.querySelectorAll('button')].some(b=>b.textContent==='Install update'))throw Error('Install choice missing');
    })()`);
    if(networkCalls!==1)throw Error('Checking fetched an installer before confirmation');
    await window.webContents.executeJavaScript("document.querySelector('.update-review').scrollIntoView({block:'center'})");
    await new Promise(r=>setTimeout(r,300));
    writeFileSync(join(app.getPath('temp'),'gameatlas-verification','update-review.png'),(await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`(async()=>{
     [...document.querySelector('.update-review').querySelectorAll('button')].find(b=>b.textContent==='Not now').click();
     for(let n=0;n<30&&document.querySelector('.update-review');n++)await new Promise(r=>setTimeout(r,100));
     if(document.querySelector('.update-review'))throw Error('Not now did not dismiss review');
    })()`);
    if(networkCalls!==1)throw Error('Postponing triggered a download');
   }finally{globalThis.fetch=realFetch;}
   mkdirSync(join(app.getPath('temp'),'gameatlas-verification'),{recursive:true});
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','result.json'),JSON.stringify({ok:true,packaged:app.isPackaged,blankInstall:true,wizard:true,settings:true,backupRestore:true,artworkScan:true,artworkWindow:true,previewFallback:true,updateConsent:true,releaseNotes:true,dashboard:true,localArtworkRestore:true,completedAt:new Date().toISOString()}));
   await window.webContents.executeJavaScript(`(async()=>{
    document.querySelector('[data-slot="dialog-close"]')?.click();
    await new Promise(r=>setTimeout(r,200));
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Dashboard').click();
    await new Promise(r=>setTimeout(r,300));
    if(!document.querySelector('.collection-dashboard'))throw Error('Dashboard navigation failed');
   })()`);
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','dashboard.png'),(await window.webContents.capturePage()).toPNG());
   console.log('WIZARD_SETTINGS_BACKUP_OK');app.exit(0);
  }catch(e){console.error(e);app.exit(1);}
 }
}).catch(e=>{console.error(e);if(!smoke)dialog.showErrorBox('GameAtlas could not start',String(e));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>store?.close());
