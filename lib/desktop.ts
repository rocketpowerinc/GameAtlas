import type {Preferences} from '../desktop/preferences';
declare global {interface Window {gameAtlas:{startLibrary:()=>Promise<boolean>;getSettings:()=>Promise<Preferences>;saveSettings:(input:{backupFolder:string;backupMode:string},complete:boolean)=>Promise<Preferences>;request:(path:string,method:string,body?:unknown)=>Promise<{ok:boolean;data:any;warning?:string}>;exportBackup:()=>Promise<string>;restoreBackup:()=>Promise<boolean>;chooseBackupFolder:()=>Promise<string>;openBackups:()=>Promise<string>}}}
export async function desktopRequest(path:string,options:RequestInit={}){
 if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
 const result=await window.gameAtlas.request(path,options.method||'GET',options.body?JSON.parse(String(options.body)):undefined);
 if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
 if(result.warning)window.dispatchEvent(new CustomEvent('backup-warning',{detail:result.warning}));
 return {ok:result.ok,json:async()=>result.data};
}
export const artworkUrl=(url?:string)=>url?'atlas://art/?url='+encodeURIComponent(url):'';
