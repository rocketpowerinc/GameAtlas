import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu } from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
 if(!safeArt(raw))return new Response('Unsupported artwork source',{status:400});
 const key=createHash('sha256').update(raw).digest('hex'); const path=join(app.getPath('userData'),'artwork',key);
 if(existsSync(path))return new Response(readFileSync(path),{headers:{'Content-Type':readFileSync(path+'.type','utf8')}});
 if(inflight.has(key))return (await inflight.get(key)!).clone();
 const task=(async()=>{
  let url=raw; let response:Response|undefined;
  for(let n=0;n<5;n++){response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(15000)});
   if(response.status>=300&&response.status<400){url=new URL(response.headers.get('location')||'',url).href;if(!safeArt(url))throw new Error('Unsupported redirect');continue;}break;}
  if(!response?.ok)throw new Error('Artwork unavailable');
  const type=response.headers.get('content-type')?.split(';')[0]||'';
  if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type))throw new Error('Unsupported image');
  const reader=response.body!.getReader(); const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10_000_000){await reader.cancel();throw new Error('Image too large');}chunks.push(value);}
  const buffer=Buffer.concat(chunks);writeFileSync(path+'.type',type);writeFileSync(path+'.tmp',buffer);renameSync(path+'.tmp',path);
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
    if(body.action==='details'&&c&&typeof c.name==='string'&&c.name.length<=300&&(c.wikiId||c.steamId)&&[c.wikiId,c.steamId].every(id=>id===undefined||Number.isSafeInteger(id)&&id>0))return {ok:true,data:await gameDetails(c)};
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
 ipcMain.handle('get-settings',event=>{trusted(event);return preferences.read();});
 ipcMain.handle('save-settings',(event,input,complete)=>{trusted(event);if(backupBusy)throw Error('Wait for backup or restore to finish.');if(typeof complete!=='boolean')throw Error('Invalid settings.');
  preferences.configure(input,complete);preferences.run(store,'change');return preferences.read();
 });
 ipcMain.handle('backup-folder',async event=>{trusted(event);const result=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory'],defaultPath:preferences.read().backupFolder});return result.canceled?'':result.filePaths[0];});
 ipcMain.handle('open-backups',async event=>{trusted(event);const folder=preferences.read().backupFolder;mkdirSync(folder,{recursive:true});return shell.openPath(folder);});
 Menu.setApplicationMenu(null);
 window=new BrowserWindow({width:1440,height:960,minWidth:900,minHeight:650,show:!smoke,title:'GameAtlas',icon:join(__dirname,'../public/icon-512.png'),backgroundColor:'#101216',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
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
    const saved=await window.gameAtlas.request('/api/library','PUT',{...lib,games:[{id:'test',values:{Title:'Test game'}}]});
    if(!saved.ok)throw Error('Save failed');
    const rejected=await window.gameAtlas.request('/api/library','PUT',{...saved.data,fields:[]});
    if(rejected.ok)throw Error('Property editing was accepted');
    document.querySelector('[aria-label="Refresh library"]').click();await wait();
    if(!document.querySelector('.game-card'))throw Error('Game card missing');
    document.querySelector('[aria-label="Settings"]').click();await wait();
    if(document.body.textContent.includes('Properties & backups')||document.body.textContent.includes('Add property'))throw Error('Property controls remain');
   })()`);
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','settings.png'),(await window.webContents.capturePage()).toPNG());
   const archivePath=join(app.getPath('temp'),'gameatlas-wizard-'+process.pid+'.gameatlas');
   dialog.showSaveDialog=(async()=>({canceled:false,filePath:archivePath})) as typeof dialog.showSaveDialog;
   dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[archivePath]})) as typeof dialog.showOpenDialog;
   dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as typeof dialog.showMessageBox;
   await window.webContents.executeJavaScript('window.gameAtlas.exportBackup()');
   store.save({...store.read(),games:[]},false);
   await window.webContents.executeJavaScript('window.gameAtlas.restoreBackup()');
   if(store.read().games.length!==1)throw Error('Restore failed');
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
   let launched=false,finished=false;
   const simulated=new DesktopUpdater(store,()=>{},{
    latest:async()=>({version:'99.0.0',url:'',size:1,digest:''}),
    download:async()=> 'test-only-not-executed.exe',
    launch:async()=>{if(readdirSync(store.backupDir).filter(n=>n.startsWith('before-update-')).length<=before)throw Error('Update safety backup missing');launched=true;},
    finish:()=>{finished=true;},packaged:()=>true
   });
   if((await simulated.check()).state!=='installing'||!launched||!finished)throw Error('Install handoff failed');
   mkdirSync(join(app.getPath('temp'),'gameatlas-verification'),{recursive:true});
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','result.json'),JSON.stringify({ok:true,packaged:app.isPackaged,blankInstall:true,wizard:true,settings:true,backupRestore:true,completedAt:new Date().toISOString()}));
   console.log('WIZARD_SETTINGS_BACKUP_OK');app.exit(0);
  }catch(e){console.error(e);app.exit(1);}
 }
}).catch(e=>{console.error(e);if(!smoke)dialog.showErrorBox('GameAtlas could not start',String(e));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>store?.close());
