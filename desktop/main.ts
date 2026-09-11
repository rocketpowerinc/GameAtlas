import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu } from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LibraryStore } from './store';
import { writeBackup, readBackup, missingArtwork } from './backup';
import { searchGames, gameDetails } from '../lib/game-lookup-server';
protocol.registerSchemesAsPrivileged([{scheme:'atlas',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const smoke=process.argv.includes('--smoke-test');
if(smoke)app.setPath('userData',join(app.getPath('temp'),'gameatlas-smoke-'+process.pid));
if(!app.requestSingleInstanceLock())app.quit();
let window:BrowserWindow; let store:LibraryStore;
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
function mirror(){const settings=join(app.getPath('userData'),'settings.json');if(!existsSync(settings))return;
 const folder=JSON.parse(readFileSync(settings,'utf8')).backupFolder;if(!folder)return;
 mkdirSync(folder,{recursive:true});const p=join(folder,'gameatlas-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 writeFileSync(p+'.tmp',JSON.stringify({format:'gameatlas-v1',...store.read()},null,2));renameSync(p+'.tmp',p);
}
app.whenReady().then(async()=>{
 app.setAppUserModelId('com.rocketpowerinc.gameatlas');
 mkdirSync(join(app.getPath('userData'),'artwork'),{recursive:true});
 store=new LibraryStore(app.getPath('userData'),join(__dirname,'../data/library.json'));
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
    const saved=store.save(body);let warning='';try{mirror();}catch{warning='Saved locally, but your chosen backup folder is unavailable.';}
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
   const {filePath}=await dialog.showSaveDialog(window,{defaultPath:'gameatlas-backup-'+new Date().toISOString().slice(0,10)+'.gameatlas',filters:[{name:'Complete GameAtlas backup',extensions:['gameatlas']}]});
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
   try{mirror();}catch{await dialog.showMessageBox(window,{type:'warning',message:'Restored locally, but the additional backup folder is unavailable.'});}
   return true;
  }finally{restoring=false;backupBusy=false;}
 });
 ipcMain.handle('backup-folder',async event=>{trusted(event);if(backupBusy)throw Error('Wait for the backup or restore to finish.');const result=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory']});if(result.canceled)return false;writeFileSync(join(app.getPath('userData'),'settings.json'),JSON.stringify({backupFolder:result.filePaths[0]}));mirror();return true;});
 ipcMain.handle('open-backups',async event=>{trusted(event);return shell.openPath(store.backupDir);});
 Menu.setApplicationMenu(null);
 window=new BrowserWindow({width:1440,height:960,minWidth:900,minHeight:650,show:!smoke,title:'GameAtlas',icon:join(__dirname,'../public/icon-512.png'),backgroundColor:'#101216',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 window.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))void shell.openExternal(url);return {action:'deny'};});
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('atlas://app/')){event.preventDefault();if(/^https?:\/\//i.test(url))void shell.openExternal(url);}});
 window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 app.on('second-instance',()=>{if(window.isMinimized())window.restore();window.focus();});
 await window.loadURL('atlas://app/');
 // Warm the cache gradually; failures are retried when a game is displayed or on the next launch.
 if(!smoke){void(async()=>{for(const game of store.read().games){if(game.lookup?.coverUrl)try{await artwork(game.lookup.coverUrl);}catch{}}})();}
 if(smoke){
  try{
   await new Promise(r=>setTimeout(r,2000));
   const result=await window.webContents.executeJavaScript(`(async()=>{const r=await window.gameAtlas.request('/api/library','GET');if(!r.ok||r.data.games.length!==509)throw Error('Library import failed');if(!document.querySelector('.game-card'))throw Error('Cards not rendered');const saved=await window.gameAtlas.request('/api/library','PUT',r.data);if(!saved.ok||saved.data.revision!==r.data.revision+1)throw Error('Save failed');return {games:r.data.games.length,title:document.title};})()`);

   await window.webContents.executeJavaScript(`(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,800));
    document.querySelector('[aria-label="Table view"]').click();await wait();
    if(!document.querySelector('table'))throw Error('List view failed');
    document.querySelector('[aria-label="Grid view"]').click();await wait();
    document.querySelector('.game-card-main').click();await wait();
    if(!document.querySelector('[role="dialog"]'))throw Error('Editor failed');
   })()`);
   mkdirSync(join(app.getPath('temp'),'gameatlas-verification'),{recursive:true});
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','editor.png'),(await window.webContents.capturePage()).toPNG());
   const cover=store.read().games.find(g=>g.lookup?.coverUrl)?.lookup?.coverUrl;
   if(cover){try{
    const first=await artwork(cover);if(!first.ok)throw Error('Image failed');
    const realFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Offline');};
    try {const cached=await artwork(cover);if(!cached.ok)throw Error('Offline image failed');}finally{globalThis.fetch=realFetch;}
    console.log('ARTWORK_CACHE_OK');
   }catch(e){console.error('ARTWORK_TEST_FAILED',e);throw e;}}
   const original=store.read();
   const withCover=original.games.find(g=>g.lookup?.coverUrl)!;
   store.save({...original,games:[withCover]});
   const archivePath=join(app.getPath('temp'),'gameatlas-verification','ipc.gameatlas');
   dialog.showSaveDialog=(async()=>({canceled:false,filePath:archivePath})) as typeof dialog.showSaveDialog;
   dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[archivePath]})) as typeof dialog.showOpenDialog;
   dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as typeof dialog.showMessageBox;
   await window.webContents.executeJavaScript('window.gameAtlas.exportBackup()');
   const exported=readBackup(archivePath);if(exported.summary.images<1||exported.summary.missing.length)throw Error('Full export missed artwork');
   store.save({...store.read(),games:[]});
   const restored=await window.webContents.executeJavaScript('window.gameAtlas.restoreBackup()');
   if(!restored||JSON.stringify(store.read().games)!==JSON.stringify([withCover]))throw Error('Full restore IPC failed');
   store.save({...original,revision:store.read().revision});
   console.log('FULL_BACKUP_IPC_OK');
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','result.json'),JSON.stringify({ok:true,...result,packaged:app.isPackaged,completedAt:new Date().toISOString()}));
   console.log('DESKTOP_SMOKE_OK',JSON.stringify(result));app.exit(0);
  }catch(e){console.error(e);app.exit(1);}
 }
}).catch(e=>{console.error(e);if(!smoke)dialog.showErrorBox('GameAtlas could not start',String(e));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>store?.close());
