import {withEsrb,searchEsrb,chooseEsrb} from '../lib/esrb';
import {withCurrentLibraryShape} from '../lib/library';
import { app, BrowserWindow, ipcMain, protocol, net, shell, dialog, Menu, nativeImage } from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {ArtworkScan} from './artwork-scan';
import {DescriptionScan} from './description-scan';
import { LibraryStore } from './store';
import { PreferencesStore } from './preferences';
import { DesktopUpdater } from './updater';
import { writeBackup, readBackup, missingArtwork, pruneUnusedArtwork } from './backup';
import { searchGames, gameDetails } from '../lib/game-lookup-server';
import {exportCollectionPdf,selectPdfLibrary,type PdfScope} from './pdf-export';
import {portableUserData} from './portable';
protocol.registerSchemesAsPrivileged([{scheme:'atlas',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const smoke=process.argv.includes('--smoke-test');
const portableData=portableUserData();
if(portableData)app.setPath('userData',portableData);
if(smoke)app.setPath('userData',join(app.getPath('temp'),'gameatlas-smoke-'+process.pid));
const primaryInstance=smoke||app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
let window:BrowserWindow; let store:LibraryStore;let preferences:PreferencesStore;
let backupBusy=false;let restoring=false;
function upgradeLibrary(){const original=store.read();const updated=withCurrentLibraryShape(withEsrb(original));if(JSON.stringify(updated)!==JSON.stringify(original)){store.snapshot();store.save(updated,false);}}
const root=join(__dirname,'../dist');
const artHosts=['ignimgs.com','ign.com','wikimedia.org','steamstatic.com','steamcdn-a.akamaihd.net'];
const safeArt=(raw:string)=>{try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&artHosts.some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}};
const inflight=new Map<string,Promise<Response>>();
async function artwork(raw:string):Promise<Response>{
 if(restoring)throw Error('Artwork is being restored.');
 const local=/^https:\/\/local-art\.gameatlas\.invalid\/[a-f0-9]{64}$/.test(raw);
 const key=createHash('sha256').update(raw).digest('hex'); const path=join(app.getPath('userData'),'artwork',key);
 if(existsSync(path)&&existsSync(path+'.type')&&statSync(path).size>0){const type=readFileSync(path+'.type','utf8');if(['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type))return new Response(readFileSync(path),{headers:{'Content-Type':type}});}
 if(!local&&!safeArt(raw))return new Response('Unsupported artwork source',{status:400});
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
 if(!primaryInstance)return;
 app.setAppUserModelId('com.rocketpowerinc.gameatlas');
 mkdirSync(join(app.getPath('userData'),'artwork'),{recursive:true});
 const existing=existsSync(join(app.getPath('userData'),'library.sqlite'));
 store=new LibraryStore(app.getPath('userData'),join(__dirname,'../data/library.json'));
 upgradeLibrary();
 pruneUnusedArtwork(store.read(),store.directory);
 preferences=new PreferencesStore(app.getPath('userData'),existing);
 const scan=new ArtworkScan(store,{
  cached:url=>{const path=join(store.directory,'artwork',createHash('sha256').update(url).digest('hex'));return existsSync(path)&&existsSync(path+'.type')&&statSync(path).size>0;},
  download:async url=>{const response=await artwork(url);if(!response.ok)throw Error('Artwork could not be downloaded.');},
  search:searchGames,details:gameDetails
 });
 const descriptions=new DescriptionScan(store);
 ipcMain.handle('artwork-status',event=>{trusted(event);return scan.read();});
 ipcMain.handle('cancel-artwork-scan',event=>{trusted(event);scan.cancel();});
 ipcMain.handle('scan-artwork',async event=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  if(!preferences.read().setupComplete)throw Error('Finish setup first.');
  backupBusy=true;
  try{const result=await scan.run();pruneUnusedArtwork(store.read(),store.directory);if(result.added)preferences.run(store,'change');return {...result,error:result.error||preferences.error||undefined};}finally{backupBusy=false;}
 });
 ipcMain.handle('apply-artwork',async(event,id,url)=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  if(!preferences.read().setupComplete)throw Error('Finish setup first.');
  backupBusy=true;try{await scan.apply(id,url);pruneUnusedArtwork(store.read(),store.directory);preferences.run(store,'change');if(preferences.error)throw Error(preferences.error);}finally{backupBusy=false;}
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
   await scan.apply(id,url);pruneUnusedArtwork(store.read(),store.directory);preferences.run(store,'change');if(preferences.error)throw Error(preferences.error);return url;
  }finally{backupBusy=false;}
 });
 ipcMain.handle('choose-hardware-artwork-file',async event=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  const selected=await dialog.showOpenDialog(window,{title:'Choose hardware artwork',properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp','gif','avif']}]});
  if(selected.canceled||!selected.filePaths[0])return false;
  const path=selected.filePaths[0];if(statSync(path).size>10_000_000)throw Error('Choose an image smaller than 10 MB.');
  const image=nativeImage.createFromBuffer(readFileSync(path));if(image.isEmpty())throw Error('This file is not a readable image.');
  const size=image.getSize(),bytes=(Math.max(size.width,size.height)>1400?image.resize(size.width>=size.height?{width:1400}:{height:1400}):image).toPNG();
  const url='https://local-art.gameatlas.invalid/'+createHash('sha256').update(bytes).digest('hex'),key=createHash('sha256').update(url).digest('hex'),destination=join(store.directory,'artwork',key);
  writeFileSync(destination+'.type','image/png');writeFileSync(destination+'.tmp',bytes);renameSync(destination+'.tmp',destination);return url;
 });
 ipcMain.handle('description-status',event=>{trusted(event);return descriptions.missing();});
 ipcMain.handle('apply-description',async(event,id,description)=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  if(!preferences.read().setupComplete)throw Error('Finish setup first.');
  if(typeof id!=='string'||typeof description!=='string'||description.length>6000)throw Error('Enter a valid description.');
  backupBusy=true;
  try{descriptions.apply(id,description);preferences.run(store,'change');if(preferences.error)throw Error(preferences.error);}
  finally{backupBusy=false;}
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
   if(path==='/api/library'&&method==='GET'){upgradeLibrary();return {ok:true,data:store.read()};}
   if(path==='/api/library'&&method==='PUT'){
    if(backupBusy)throw Error('Wait for the backup or restore to finish.');
    if(!preferences.read().setupComplete)throw Error('Finish setup before editing your library.');
    if(JSON.stringify(body.fields)!==JSON.stringify(store.read().fields))throw Error('Library properties cannot be added, removed, or changed.');
    const saved=store.save(body,false);pruneUnusedArtwork(saved,store.directory);preferences.run(store,'change');const warning=preferences.error;
    return {ok:true,data:saved,warning};
   }
   if(path==='/api/game-lookup'&&method==='POST'){
    if(JSON.stringify(body).length>3000)throw new Error('Search request too long.');
    if(body.action==='search'&&typeof body.query==='string'&&body.query.trim().length>=2&&body.query.length<=500)return {ok:true,data:await searchGames(body.query.trim())};
    const c=body.candidate;
    if(['details','artwork'].includes(body.action)&&c&&typeof c.name==='string'&&c.name.length<=300&&(c.wikiId||c.steamId)&&[c.wikiId,c.steamId].every(id=>id===undefined||Number.isSafeInteger(id)&&id>0)){
     const details=await gameDetails(c);if(body.action==='details'){if(!smoke)try{const match=chooseEsrb(await searchEsrb(String(details.values.Title||c.name)),[String(details.values.Title||c.name)],Array.isArray(details.values.Platform)?details.values.Platform:[]);if(match){details.values.ESRB=match.rating;details.sources.push({name:'ESRB',url:match.url});}}catch{}return {ok:true,data:details};}
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
    const choice=await dialog.showMessageBox(window,{type:'warning',title:'Some thumbnails are unavailable',message:missing.length+' artwork links could not be downloaded.',detail:'All collection records and descriptions will be included. These missing image files cannot be restored offline from this backup. You can cancel and retry when the sources are available.',buttons:['Cancel','Save with missing thumbnails'],defaultId:0,cancelId:0});
    if(choice.response!==1)return '';
   }
   pruneUnusedArtwork(store.read(),store.directory);const result=writeBackup(store.db,store.directory,filePath);
   return 'Backup saved: '+result.hardware+' hardware items, '+result.games+' games and '+result.images+' image files.'+(result.missing.length?' '+result.missing.length+' thumbnails are missing.':' All linked thumbnails are included.');
  }finally{backupBusy=false;}
 });
 ipcMain.handle('export-collection-pdf',async (event,requestedScope:unknown)=>{
  trusted(event);if(backupBusy)throw Error('Wait for the current operation to finish.');
  const scope:PdfScope=requestedScope==='physical'?'physical':'all';
  const physical=scope==='physical',catalog=selectPdfLibrary(store.read(),scope);
  const name=physical?'GameAtlas Physical Collection':'GameAtlas Entire Library';
  const {filePath}=await dialog.showSaveDialog(window,{title:physical?'Export physical collection PDF':'Export entire library PDF',defaultPath:join(app.getPath('documents'),name+' '+new Date().toISOString().slice(0,10)+'.pdf'),filters:[{name:'PDF document',extensions:['pdf']}]});
  if(!filePath)return '';
  const destination=filePath.toLowerCase().endsWith('.pdf')?filePath:filePath+'.pdf';
  backupBusy=true;
  try{const result=await exportCollectionPdf(catalog,store.directory,destination,physical?'Physical Collection Catalog':'Entire Library Catalog');return `${physical?'Physical collection':'Entire library'} PDF saved with ${result.hardware} hardware items and ${result.games} games.`;}
  finally{backupBusy=false;}
 });
 ipcMain.handle('restore-backup',async event=>{
  trusted(event);if(backupBusy)throw Error('A backup or restore is already running.');backupBusy=true;
  try{
   const {filePaths,canceled}=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'GameAtlas backups',extensions:['gameatlas','json']}]});
   if(canceled)return false;
   const backup=readBackup(filePaths[0]);
   const detail=backup.summary.legacy?'This older JSON backup contains no image files. Your existing cached images will be kept.':backup.summary.images+' image files will be restored.'+(backup.summary.missing.length?' '+backup.summary.missing.length+' linked thumbnails are missing from this backup.':'');
   const choice=await dialog.showMessageBox(window,{type:'warning',title:'Restore GameAtlas backup',message:'Replace your collection with '+backup.summary.games+' games and '+backup.summary.hardware+' hardware items?',detail:detail+' A complete safety backup of the current collection and its linked artwork will be saved first.',buttons:['Cancel','Restore backup'],defaultId:0,cancelId:0});
   if(choice.response!==1)return false;
   restoring=true;await Promise.allSettled([...inflight.values()]);
   store.restore(backup);pruneUnusedArtwork(store.read(),store.directory);
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
    store.restore({library,artwork:[],summary:{games:0,hardware:0,images:0,missing:[],createdAt:'',legacy:false}});
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
 app.on('second-instance',()=>{if(window.isMinimized())window.restore();window.show();window.focus();});
 await window.loadURL('atlas://app/');
 preferences.run(store,'startup');
 const schedule=setInterval(()=>{if(!backupBusy)preferences.run(store,'timer');},60000);schedule.unref();
 // Warm the cache gradually; failures are retried when a game is displayed or on the next launch.
 if(!smoke){void(async()=>{const library=store.read();for(const url of [...library.games.map(game=>game.lookup?.coverUrl),...(library.hardware??[]).map(item=>item.coverUrl)]){if(url)try{await artwork(url);}catch{}}})();}
 if(smoke){
  try{
   await new Promise(r=>setTimeout(r,1500));
   mkdirSync(join(app.getPath('temp'),'gameatlas-verification'),{recursive:true});
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','welcome.png'),(await window.webContents.capturePage()).toPNG());
   const smokeHardwareArtwork='https://manufacturer.example/test-console.png',smokeHardwareKey=createHash('sha256').update(smokeHardwareArtwork).digest('hex'),smokeHardwarePath=join(store.directory,'artwork',smokeHardwareKey);
   writeFileSync(smokeHardwarePath,readFileSync(join(__dirname,'../public/icon-512.png')));writeFileSync(smokeHardwarePath+'.type','image/png');
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
    const saved=await window.gameAtlas.request('/api/library','PUT',{...lib,hardware:[{id:'hardware-test',name:'Test Console',type:'Console',manufacturer:'Test Maker',model:'Special Edition',releaseDate:'2020-01-01',notes:'Keep the original box.',description:'A test console description.',coverUrl:'https://manufacturer.example/test-console.png'}],games:[{id:'test',values:{Title:'Test game',Ownership:['Physical'],Condition:['Reproduction','Special Edition'],Status:['Must Play','Replay'],Badges:['Favorite','Play with Kids'],'Play Next On':['Steam','Playstation 5'],Platform:['Switch'],Genre:['Adventure'],Studio:'Test Studio',Score:8.5,'Release Date':'2024-01-02',Notes:'Remember this test note.'},lookup:{description:'No description has been added for this game yet.',sources:[{name:'IGN',url:'https://www.ign.com/games/test-game'},{name:'Steam',url:'https://store.steampowered.com/app/2'}]}}]});
    if(!saved.ok)throw Error('Save failed');
    const rejected=await window.gameAtlas.request('/api/library','PUT',{...saved.data,fields:[]});
    if(rejected.ok)throw Error('Property editing was accepted');
    window.dispatchEvent(new Event('library-updated'));await wait();
    const compact=document.querySelector('.game-card-compact');
    const compactReplay=compact?.querySelector('.game-card-replay'),compactBadges=compact?.querySelector('.game-card-badges');
    if(!compact||!compact.classList.contains('score-great')||compact.querySelector('h2')?.textContent!=='Test game'||compact.querySelector('.game-info')||compact.querySelector('.card-bottom')||compact.querySelectorAll('.game-badge-icon').length!==2||compact.querySelector('.compact-card-art .game-card-badges')||compactBadges.getBoundingClientRect().top<compactReplay.getBoundingClientRect().bottom||!compactReplay.textContent.includes('Replay On')||compactReplay.querySelectorAll('.replay-platform-logo').length!==2||![...compactReplay.querySelectorAll('.replay-platform-icon')].some(icon=>icon.title==='Steam'&&icon.querySelector('.replay-platform-tooltip')?.textContent==='Steam')||![...compact.querySelectorAll('.game-badge-icon')].some(icon=>icon.title==='Favorite'&&icon.querySelector('.game-badge-tooltip')?.textContent==='Favorite'))throw Error('Compact card is not artwork-and-title only or lost its replay logos, badge tooltips, and bottom rows');
    [...document.querySelectorAll('.card-view-toggle button')].find(b=>b.textContent.includes('Standard')).click();await wait();
    const standardCard=document.querySelector('.game-card'),standardBadges=standardCard?.querySelector(':scope > .game-card-badges'),standardFooter=standardCard?.querySelector('.card-bottom'),standardReplay=standardCard?.querySelector(':scope > .game-card-replay');
    if(!standardCard||!document.querySelector('.game-release-date')?.textContent.includes('2024-01-02')||!standardBadges||!standardReplay||standardCard.lastElementChild!==standardBadges||standardReplay.previousElementSibling!==standardFooter||standardReplay.nextElementSibling!==standardBadges||standardReplay.querySelectorAll('.replay-platform-icon').length!==2)throw Error('Standard card, release date, Replay On row, or bottom badge row missing');
    if(document.querySelector('.game-link')?.href!=='https://www.ign.com/games/test-game')throw Error('Card shortcut did not prioritize IGN');
    document.querySelector('.game-card-main').click();await wait();
    if(document.querySelectorAll('.game-page-badge').length!==2||!document.querySelector('.game-page-badges')?.textContent.includes('One of your personal favorite games.')||!document.querySelector('.game-page-badges')?.textContent.includes('A good game to play together with children.')||!document.querySelector('.game-page-highlights')?.textContent.includes('Replay on: Steam, Playstation 5')||!document.querySelector('.game-page-highlights')?.textContent.includes('Condition: Reproduction')||document.querySelector('[title="An unofficial reproduction cartridge or disc."]')?.textContent!=='Condition: Reproduction')throw Error('Read-only badges, Condition, or Replay On detail missing');
    document.querySelector('.game-page-edit-top').click();await wait();
    if(document.querySelectorAll('.game-badge-choice').length!==4||!document.querySelector('.game-badge-picker')?.textContent.includes('Play with Kids')||document.querySelector('.game-badge-picker')?.closest('.field')?.querySelector(':scope > label')?.textContent!=='Badges')throw Error('Badge editor missing or mislabeled');
    const conditionChoices=document.querySelector('[aria-label="Condition"]');if(!conditionChoices||conditionChoices.querySelectorAll('.condition-choice').length!==5||!conditionChoices.textContent.includes('An unofficial reproduction cartridge or disc.')||[...conditionChoices.querySelectorAll('[data-slot="checkbox"]')].filter(toggle=>toggle.getAttribute('aria-checked')==='true').length!==2)throw Error('Physical Condition editor, choices, tooltip text, or selections missing');
    let ownershipChoices=document.querySelector('[aria-label="Ownership"]'),physicalToggle=[...ownershipChoices.querySelectorAll('.choice')].find(choice=>choice.textContent.trim()==='Physical')?.querySelector('[data-slot="checkbox"]');physicalToggle?.click();await wait();if(document.querySelector('[aria-label="Condition"]'))throw Error('Condition editor remains visible without Physical ownership');ownershipChoices=document.querySelector('[aria-label="Ownership"]');physicalToggle=[...ownershipChoices.querySelectorAll('.choice')].find(choice=>choice.textContent.trim()==='Physical')?.querySelector('[data-slot="checkbox"]');physicalToggle?.click();await wait();if([...document.querySelector('[aria-label="Condition"]')?.querySelectorAll('[data-slot="checkbox"]')??[]].some(toggle=>toggle.getAttribute('aria-checked')==='true'))throw Error('Hidden Condition values were not cleared when Physical ownership was removed');
    let replayOnChoices=document.querySelector('[aria-label="Replay On"]');if(!replayOnChoices||[...replayOnChoices.querySelectorAll('.choice')].slice(0,4).map(choice=>choice.textContent.trim()).join('|')!=='Steam|Switch 2|Playstation 5|Xbox Series X')throw Error('Replay On choices missing or out of order');
    if([...replayOnChoices.querySelectorAll('[data-slot="checkbox"]')].filter(toggle=>toggle.getAttribute('aria-checked')==='true').length!==2)throw Error('Replay On does not preserve multiple selections');
    const statusChoices=document.querySelector('[aria-label="Status"]'),replayChoice=[...statusChoices.querySelectorAll('.choice')].find(choice=>choice.textContent.trim()==='Replay'),replayToggle=replayChoice?.querySelector('[data-slot="checkbox"]');replayToggle?.click();await wait();if(document.querySelector('[aria-label="Replay On"]'))throw Error('Replay On remains visible when Replay status is off');replayToggle?.click();await wait();replayOnChoices=document.querySelector('[aria-label="Replay On"]');if(!replayOnChoices)throw Error('Replay On did not return when Replay status was restored');
    const favoriteChoice=[...document.querySelectorAll('.game-badge-choice')].find(choice=>choice.textContent.includes('Favorite')),favoriteToggle=favoriteChoice?.querySelector('[data-slot="checkbox"]');
    if(favoriteToggle?.getAttribute('aria-checked')!=='true')throw Error('Existing badge was not selected');favoriteToggle.click();await wait();
    if(favoriteToggle.getAttribute('aria-checked')!=='false')throw Error('Badge could not be removed');favoriteToggle.click();await wait();
    if(favoriteToggle.getAttribute('aria-checked')!=='true')throw Error('Badge could not be added');
    document.querySelector('[data-slot="dialog-close"]').click();await wait();
    if(document.querySelector('[aria-label="Refresh library"]')||document.querySelector('[aria-label="Grid view"]')||document.querySelector('[aria-label="Table view"]')||document.querySelector('.library-table'))throw Error('Removed library controls remain');
    const search=document.querySelector('.library-search').getBoundingClientRect(),filters=[...document.querySelectorAll('.filter-row .picker')].map(element=>element.getBoundingClientRect());
    if(filters.length!==8||document.querySelector('[aria-label="Filter play next on"]')||filters.some(filter=>filter.top<search.bottom)||Math.max(...filters.map(filter=>filter.width))-Math.min(...filters.map(filter=>filter.width))>2)throw Error('Search and filter layout is uneven or destination filter remains');
    const badgeFilter=document.querySelector('[aria-label="Filter badge"]');badgeFilter.click();await wait();
    const kidsBadge=[...document.querySelectorAll('[role="option"]')].find(option=>option.textContent.includes('Play with Kids'));if(!kidsBadge)throw Error('Badge filter missing');kidsBadge.click();await wait();
    if(!badgeFilter.textContent.includes('Play with Kids')||document.querySelectorAll('.game-card').length!==1)throw Error('Badge filter did not select matching games');
    const conditionFilter=document.querySelector('[aria-label="Filter condition"]');conditionFilter.click();await wait();
    const reproCondition=[...document.querySelectorAll('[role="option"]')].find(option=>option.textContent.includes('Condition: Reproduction'));if(!reproCondition)throw Error('Condition filter missing');reproCondition.click();await wait();
    if(!conditionFilter.textContent.includes('Condition: Reproduction')||document.querySelectorAll('.game-card').length!==1)throw Error('Condition filter did not select matching physical games');
    const notesFilter=document.querySelector('[aria-label="Filter notes"]');notesFilter.click();await wait();
    const hasNotes=[...document.querySelectorAll('[role="option"]')].find(option=>option.textContent.includes('Notes: Present'));if(!hasNotes)throw Error('Notes filter missing');hasNotes.click();await wait();
    if(!notesFilter.textContent.includes('Notes: Present')||document.querySelectorAll('.game-card').length!==1)throw Error('Notes filter did not select matching games');
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Dashboard').click();await wait();
    const dashboardCards=[...document.querySelectorAll('.dashboard-total')].map(card=>card.querySelector('span')?.textContent);
    if(!document.querySelector('.collection-dashboard')||dashboardCards.join('|')!=='All Games|Owned Physical|Owned Digital|Completed|Playing|Must Play|Replay|Wish List|Upcoming'||!document.querySelector('[aria-label="All Games: 1 games"]')||!document.querySelector('[aria-label="Owned Physical: 1 games"]')||!document.querySelector('[aria-label="Owned Digital: 0 games"]')||!document.querySelector('[aria-label="Must Play: 1 games"]')||!document.querySelector('[aria-label="Replay: 1 games"]')||!document.querySelector('[aria-label="Upcoming: 0 games"]'))throw Error('Dashboard totals are wrong');
    document.querySelector('[aria-label="Owned Physical: 1 games"]').click();await wait();
    if(!document.querySelector('.dashboard-filter')||document.querySelectorAll('.game-card').length!==1)throw Error('Dashboard drill-down failed');
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Show all games').click();
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Hardware').click();await wait();
    const hardwareImage=document.querySelector('.hardware-card img'),hardwareSections=[...document.querySelectorAll('.hardware-group h2')].map(heading=>heading.textContent).join('|');if(!document.querySelector('.hardware-collection')||document.querySelectorAll('.hardware-card').length!==1||!document.body.textContent.includes('Test Console')||!hardwareImage?.complete||!hardwareImage.naturalWidth||hardwareSections!=='Consoles|Emulation Consoles|VR|Controllers|Mobile|Peripherals|Books|Headphones|Misc')throw Error('Hardware collection, category order, or cached artwork missing');
    document.querySelector('.hardware-card').click();await wait();
    if(!document.querySelector('.hardware-page')||!document.body.textContent.includes('Keep the original box.')||!document.body.textContent.includes('Released 2020-01-01'))throw Error('Hardware detail page missing');
    document.querySelector('.game-page-edit-top').click();await wait();
    if(!document.querySelector('.hardware-editor')||!document.body.textContent.includes('Upload artwork file'))throw Error('Hardware editor missing');
    document.querySelector('[data-slot="dialog-close"]').click();await wait();
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Back to games')).click();await wait();
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
    for(let n=0;n<50;n++){await pause();const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Upload artwork file'));if(b&&!b.disabled)break;}
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Upload artwork file')).click();
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
   const pdfPath=join(app.getPath('temp'),'gameatlas-catalog-'+process.pid+'.pdf');
   dialog.showSaveDialog=(async(_window,options)=>({canceled:false,filePath:options?.filters?.some(filter=>filter.extensions.includes('pdf'))?pdfPath:archivePath})) as typeof dialog.showSaveDialog;
   dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[archivePath]})) as typeof dialog.showOpenDialog;
   dialog.showMessageBox=(async()=>({response:1,checkboxChecked:false})) as typeof dialog.showMessageBox;
   await window.webContents.executeJavaScript('window.gameAtlas.exportBackup()');
   store.save({...store.read(),games:[]},false);
   await window.webContents.executeJavaScript('window.gameAtlas.restoreBackup()');
   if(store.read().games.length!==1)throw Error('Restore failed');
   if(store.read().games[0].lookup?.coverUrl!==selectedArt||!(await artwork(selectedArt)).ok)throw Error('Selected artwork did not survive full backup/restore');
   const pdfMessage=await window.webContents.executeJavaScript("window.gameAtlas.exportCollectionPdf('all')");
   if(!pdfMessage.includes('1 hardware items')||!pdfMessage.includes('1 games')||!existsSync(pdfPath)||readFileSync(pdfPath).subarray(0,5).toString()!=='%PDF-'||statSync(pdfPath).size<10000)throw Error('Collection PDF export failed');
   const physicalPdfMessage=await window.webContents.executeJavaScript("window.gameAtlas.exportCollectionPdf('physical')");
   if(!physicalPdfMessage.includes('Physical collection')||!physicalPdfMessage.includes('1 games')||readFileSync(pdfPath).subarray(0,5).toString()!=='%PDF-')throw Error('Physical collection PDF export failed');
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
    latest:async()=>({version:'99.0.0',url:'',size:1,digest:'',flavor:'setup' as const}),
    download:async()=>{downloads++;return 'test-only-not-executed.exe';},
    launch:async()=>{if(readdirSync(store.backupDir).filter(n=>n.startsWith('before-update-')).length<=before)throw Error('Update safety backup missing');launched=true;},
    finish:()=>{finished=true;},packaged:()=>true,portableFile:()=>''
   });
   try{await simulated.install('99.0.0');throw Error('Install allowed without review');}catch(e){if(!(e instanceof Error)||!e.message.includes('review'))throw e;}
   if((await simulated.check()).state!=='available'||downloads||launched||finished)throw Error('Check installed without consent');
   simulated.dismiss();
   if(downloads||launched||finished)throw Error('Postponing installed the update');
   await simulated.check();
   try{await simulated.install('98.0.0');throw Error('Wrong release accepted');}catch(e){if(!(e instanceof Error)||!e.message.includes('review'))throw e;}
   if((await simulated.install('99.0.0')).state!=='installing'||downloads!==1||!launched||!finished)throw Error('Confirmed install failed');
   let networkCalls=0;
   globalThis.fetch=(async(input:any)=>{
    const url=String(input);
    if(url.includes('list=search'))return Response.json({query:{search:[{title:'Test game',snippet:'Test game is a video game.',pageid:1}]}});
    if(url.includes('storesearch'))return Response.json({items:[]});
    if(url.includes('action=parse'))return Response.json({parse:{title:'Test game',text:{'*':'<table class="ib-video-game"></table><p>Test description found online with enough useful detail for the player to review before saving it.</p>'}}});
    networkCalls++;return Response.json({tag_name:'v99.0.0',draft:false,prerelease:false,body:'Clearer artwork review and faster library browsing.',assets:[{id:42,name:'GameAtlas.Setup.99.0.0.exe',state:'uploaded',size:1,digest:'sha256:'+'a'.repeat(64)},{id:43,name:'GameAtlas.Portable.99.0.0.exe',state:'uploaded',size:1,digest:'sha256:'+'a'.repeat(64)}]});
   }) as typeof fetch;
   try{
    await window.webContents.executeJavaScript(`(async()=>{
     const pause=()=>new Promise(r=>setTimeout(r,100));
     const sortTrigger=document.querySelector('[aria-label="Sort games"]');sortTrigger.click();await pause();
     const oldestRelease=[...document.querySelectorAll('[role="option"]')].find(option=>option.textContent.includes('Oldest Release'));
     if(!oldestRelease)throw Error('Oldest release sort missing');oldestRelease.click();await pause();
     if(!sortTrigger.textContent.includes('Oldest Release'))throw Error('Oldest release sort could not be selected');
     document.querySelector('[aria-label="Settings"]').click();
     await pause();
     const pdfButtons=[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('PDF'));
     if(!pdfButtons.some(b=>b.textContent.includes('Physical Collection'))||!pdfButtons.some(b=>b.textContent.includes('Entire Library')))throw Error('PDF export buttons missing');
     const physicalPdf=pdfButtons.find(b=>b.textContent.includes('Physical Collection'));physicalPdf.click();
     for(let n=0;n<20&&!document.querySelector('.pdf-export-progress');n++)await pause();
     if(!document.querySelector('.pdf-export-progress')||!document.querySelector('.pdf-export-spinner'))throw Error('PDF export progress missing');
     for(let n=0;n<100&&document.querySelector('.pdf-export-progress');n++)await pause();
     if(document.querySelector('.pdf-export-progress'))throw Error('PDF export progress did not finish');
     const descriptions=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Find missing descriptions'));if(!descriptions)throw Error('Description review button missing');
     descriptions.click();
     for(let n=0;n<30&&!document.querySelector('.description-settings');n++)await pause();
     if(document.querySelector('.settings-editor')||!document.querySelector('.description-missing-game')?.textContent.includes('Test game'))throw Error('Missing-description list failed');
     document.querySelector('.description-missing-game').click();await pause();
     const textarea=document.querySelector('#missing-game-description');if(!textarea)throw Error('Manual description editor missing');
     const searchDescription=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Search for description'));if(!searchDescription)throw Error('Description search button missing');
     searchDescription.click();for(let n=0;n<50&&!textarea.value.includes('Test description found online');n++)await pause();
     if(!textarea.value.includes('Test description found online'))throw Error('Description search did not fill the editor');
     Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'A manually added description.');textarea.dispatchEvent(new Event('input',{bubbles:true}));
     [...document.querySelectorAll('button')].find(b=>b.textContent==='Save description').click();
     for(let n=0;n<30&&document.querySelector('.description-missing-game');n++)await pause();
     if(document.querySelector('.description-missing-game'))throw Error('Saved description remained missing');
     document.querySelector('[data-slot="dialog-close"]').click();await pause();
     document.querySelector('[aria-label="Settings"]').click();await pause();
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
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','result.json'),JSON.stringify({ok:true,packaged:app.isPackaged,blankInstall:true,wizard:true,settings:true,backupRestore:true,pdfExport:true,artworkScan:true,artworkWindow:true,previewFallback:true,updateConsent:true,releaseNotes:true,dashboard:true,localArtworkRestore:true,completedAt:new Date().toISOString()}));
   await window.webContents.executeJavaScript(`(async()=>{
    document.querySelector('[data-slot="dialog-close"]')?.click();
    await new Promise(r=>setTimeout(r,200));
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Dashboard').click();
    await new Promise(r=>setTimeout(r,300));
    if(!document.querySelector('.collection-dashboard'))throw Error('Dashboard navigation failed');
    if(!document.querySelector('.dashboard-unplayed')?.textContent.includes('Test game')||!document.querySelector('.dashboard-developers')?.textContent.includes('Test Studio')||!document.querySelector('.dashboard-wishlist'))throw Error('New dashboard insights missing');
    document.querySelector('.dashboard-developers .dashboard-ranked button').click();
    await new Promise(r=>setTimeout(r,200));
    if(!document.querySelector('.dashboard-filter')?.textContent.includes('Test Studio')||document.querySelectorAll('.game-card').length!==1)throw Error('Developer drill-down failed');
    [...document.querySelectorAll('button')].find(b=>b.textContent==='Dashboard').click();
    await new Promise(r=>setTimeout(r,200));
    document.querySelector('.dashboard-unplayed').scrollIntoView({block:'start'});
    await new Promise(r=>setTimeout(r,200));
   })()`);
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','dashboard.png'),(await window.webContents.capturePage()).toPNG());

   await window.webContents.executeJavaScript(`(async()=>{
    document.querySelector('.theme-toggle').click();
    await new Promise(r=>setTimeout(r,150));
    if(document.documentElement.dataset.theme!=='light'||document.documentElement.classList.contains('dark')||getComputedStyle(document.body).backgroundColor!=='rgb(245, 247, 240)')throw Error('Light theme failed');
    window.scrollTo(0,0);
   })()`);
   await new Promise(r=>setTimeout(r,200));
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','dashboard-light.png'),(await window.webContents.capturePage()).toPNG());
   await new Promise<void>(resolve=>{window!.webContents.once('did-finish-load',()=>resolve());window!.webContents.reload();});
   await window.webContents.executeJavaScript(`(async()=>{
    for(let i=0;i<50&&!document.querySelector('.theme-toggle');i++)await new Promise(r=>setTimeout(r,100));
    if(document.documentElement.dataset.theme!=='light'||localStorage.getItem('gameatlas-theme')!=='light')throw Error('Theme was not remembered');
    document.querySelector('.theme-toggle').click();
    await new Promise(r=>setTimeout(r,150));
    if(document.documentElement.dataset.theme!=='dark'||!document.documentElement.classList.contains('dark')||getComputedStyle(document.body).backgroundColor!=='rgb(13, 17, 23)')throw Error('Dark theme failed');
   })()`);
   await window.webContents.executeJavaScript(`(async()=>{
    if(!document.querySelector('[aria-label="Filter by ESRB rating"]'))throw Error('ESRB filter missing');
    document.querySelector('.game-card-main').click();await new Promise(r=>setTimeout(r,150));
    if(!document.querySelector('.game-page')||document.querySelector('#edit-ESRB'))throw Error('Game page did not open read-only');
    if(!document.querySelector('.game-page-notes')?.textContent.includes('Remember this test note.')||[...document.querySelectorAll('.game-page-properties dd')].some(value=>value.textContent.trim()==='Not set'))throw Error('Game page notes or empty-property handling failed');
    if(document.querySelectorAll('.game-page-source-links a').length!==2||!document.querySelector('.game-page-source-links')?.textContent.includes('IGN')||!document.querySelector('.game-page-source-links')?.textContent.includes('Steam'))throw Error('Multiple game sources are unclear');
    const edit=document.querySelector('.game-page-edit-top');if(!edit||edit.textContent.trim()!=='Edit'||[...document.querySelectorAll('.game-page a')].some(a=>a.textContent.includes('Game website')))throw Error('Compact edit button or website removal failed');
   })()`);
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','game-page.png'),(await window.webContents.capturePage()).toPNG());
   await window.webContents.executeJavaScript(`(async()=>{
    const edit=document.querySelector('.game-page-edit-top');if(!edit)throw Error('Edit button missing');
    edit.click();await new Promise(r=>setTimeout(r,150));
    if(![...document.querySelectorAll('button')].some(b=>b.textContent.includes('Upload file to replace artwork')))throw Error('Upload artwork button missing');
    const description=document.querySelector('#edit-game-description');if(!description||description.value!=='A manually added description.')throw Error('Description editor missing');
    const title=document.querySelector('#edit-Title'),artwork=document.querySelector('.editor-artwork');if(!title||!artwork||!(title.compareDocumentPosition(artwork)&Node.DOCUMENT_POSITION_FOLLOWING)||!(artwork.compareDocumentPosition(description)&Node.DOCUMENT_POSITION_FOLLOWING))throw Error('Editor field order is wrong');
    if(document.querySelector('#edit-source-ign')?.value!=='https://www.ign.com/games/test-game'||document.querySelector('#edit-source-steam')?.value!=='https://store.steampowered.com/app/2'||!document.querySelector('#edit-source-wikipedia')||!document.querySelector('#edit-source-howlongtobeat')||!document.querySelector('#edit-source-pricecharting')||!document.querySelector('#edit-source-youtube'))throw Error('Source URL editors missing');
    const sourceEditor=document.querySelector('.source-editor-grid'),sourceIds=[...sourceEditor.querySelectorAll('input')].map(input=>input.id);if(JSON.stringify(sourceIds)!==JSON.stringify(['edit-source-youtube','edit-source-ign','edit-source-steam','edit-source-wikipedia','edit-source-howlongtobeat','edit-source-pricecharting'])||getComputedStyle(sourceEditor).gridTemplateColumns.split(' ').length!==1)throw Error('Source editors are not ordered in full-width rows');
    if(document.getElementById('edit-Link')||document.getElementById('edit-Target Price')||document.querySelector('#end-date')||[...document.querySelectorAll('.choices')].some(group=>group.textContent.includes('Want soon')))throw Error('Retired game fields remain in the editor');
    const videoLinks=[...document.querySelectorAll('.youtube-searches a')];if(videoLinks.length!==3||!videoLinks[0].href.includes('official+trailer')||!videoLinks[1].href.includes('IGN+review')||!videoLinks[2].href.includes('Before+You+Buy+GameRanx'))throw Error('YouTube discovery fallbacks missing or out of order');
    document.querySelector('.source-youtube').scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,100));
   })()`);
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','game-editor.png'),(await window.webContents.capturePage()).toPNG());
   await window.webContents.executeJavaScript(`(async()=>{
    const description=document.querySelector('#edit-game-description');if(!description)throw Error('Description editor missing');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(description,'An edited game description.');description.dispatchEvent(new Event('input',{bubbles:true}));description.dispatchEvent(new Event('change',{bubbles:true}));
    const ign=document.querySelector('#edit-source-ign'),wiki=document.querySelector('#edit-source-wikipedia'),hltb=document.querySelector('#edit-source-howlongtobeat'),price=document.querySelector('#edit-source-pricecharting'),youtube=document.querySelector('#edit-source-youtube'),input=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    input.call(ign,'');ign.dispatchEvent(new Event('input',{bubbles:true}));input.call(wiki,'https://en.wikipedia.org/wiki/Test_Game');wiki.dispatchEvent(new Event('input',{bubbles:true}));input.call(hltb,'https://howlongtobeat.com/game/1');hltb.dispatchEvent(new Event('input',{bubbles:true}));input.call(price,'https://www.pricecharting.com/game/test-game');price.dispatchEvent(new Event('input',{bubbles:true}));input.call(youtube,'https://www.youtube.com/watch?v=test123');youtube.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));
    const rating=document.querySelector('#edit-ESRB');if(!rating||rating.value!=='Unknown')throw Error('ESRB migration/editor failed');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(rating,'T — Teen');rating.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,100));
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save game').click();await new Promise(r=>setTimeout(r,300));
    if(!document.querySelector('.esrb-badge')?.textContent.includes('T — Teen'))throw Error('ESRB save failed');
    if(document.querySelector('.game-link')?.href!=='https://www.youtube.com/watch?v=test123')throw Error('Card shortcut did not fall back to YouTube');
    document.querySelector('.game-card-main').click();await new Promise(r=>setTimeout(r,150));
    if(!document.querySelector('[data-slot="dialog-description"]')?.textContent.includes('An edited game description.'))throw Error('Edited description was not saved');
    if(document.querySelector('.game-page-source-links')?.textContent.includes('IGN')||!document.querySelector('.game-page-source-links')?.textContent.includes('Steam')||!document.querySelector('.game-page-source-links')?.textContent.includes('Wikipedia')||!document.querySelector('.game-page-source-links')?.textContent.includes('HowLongToBeat')||!document.querySelector('.game-page-source-links')?.textContent.includes('PriceCharting')||!document.querySelector('.game-page-source-links')?.textContent.includes('YouTube'))throw Error('Edited sources were not saved');
    const sourceLabels=[...document.querySelectorAll('.game-page-source-links a')].map(link=>link.textContent.trim());if(JSON.stringify(sourceLabels)!==JSON.stringify(['YouTube','Steam','Wikipedia','HowLongToBeat','PriceCharting']))throw Error('Game-page sources are not in the required order');
    document.querySelector('[data-slot="dialog-close"]').click();await new Promise(r=>setTimeout(r,150));
    document.querySelector('[aria-label="Filter by ESRB rating"]').click();await new Promise(r=>setTimeout(r,150));
    [...document.querySelectorAll('[role="option"]')].find(o=>o.textContent==='E — Everyone').click();await new Promise(r=>setTimeout(r,150));
    if(document.querySelector('.game-card'))throw Error('ESRB filter did not hide nonmatching game');
    [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Clear filters').click();await new Promise(r=>setTimeout(r,150));
   if(!document.querySelector('.game-card'))throw Error('ESRB clear filter failed');
   document.querySelector('.replay-platform-icon').scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,150));
   })()`);
   const replayPoint=await window.webContents.executeJavaScript(`(()=>{const rect=document.querySelector('.replay-platform-icon').getBoundingClientRect();return{x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}})()`);window.webContents.sendInputEvent({type:'mouseMove',x:replayPoint.x,y:replayPoint.y});await new Promise(r=>setTimeout(r,250));
   writeFileSync(join(app.getPath('temp'),'gameatlas-verification','esrb-library.png'),(await window.webContents.capturePage()).toPNG());
   const badgePoint=await window.webContents.executeJavaScript(`(()=>{const rect=document.querySelector('.game-badge-icon').getBoundingClientRect();return{x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}})()`);window.webContents.sendInputEvent({type:'mouseMove',x:badgePoint.x,y:badgePoint.y});await new Promise(r=>setTimeout(r,250));writeFileSync(join(app.getPath('temp'),'gameatlas-verification','badge-tooltip.png'),(await window.webContents.capturePage()).toPNG());
   console.log('THEME_SWITCH_AND_PERSISTENCE_OK');
   console.log('WIZARD_SETTINGS_BACKUP_OK');app.exit(0);
  }catch(e){console.error(e);app.exit(1);}
 }
}).catch(e=>{console.error(e);if(!smoke)dialog.showErrorBox('GameAtlas could not start',String(e));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>store?.close());
