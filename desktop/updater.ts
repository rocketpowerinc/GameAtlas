import {app} from 'electron';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {latest,download,type UpdateRelease} from './update-core';
import type {LibraryStore} from './store';
export type UpdateStatus={state:'idle'|'checking'|'available'|'downloading'|'installing'|'current'|'error';message:string;currentVersion:string;progress?:number;version?:string;notes?:string};
export async function launchInstaller(file:string){
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(file,['--updated','/S','--force-run'],{detached:true,stdio:'ignore',windowsHide:true});
  child.once('error',()=>reject(Error('Windows could not start the installer. The current version is unchanged.')));
  child.once('spawn',()=>{child.unref();resolve();});
 });
}
export async function launchPortableUpdate(file:string,target:string){
 const script=join(app.getPath('userData'),'updates','apply-portable-update-'+randomUUID()+'.ps1');
 writeFileSync(script,`param([string]$Source,[string]$Target,[int]$GameAtlasProcess)
Wait-Process -Id $GameAtlasProcess -ErrorAction SilentlyContinue
Copy-Item -LiteralPath $Source -Destination $Target -Force
Start-Process -FilePath $Target
Remove-Item -LiteralPath $Source -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
`,'utf8');
 await new Promise<void>((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',script,'-Source',file,'-Target',target,'-GameAtlasProcess',String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true});
  child.once('error',()=>reject(Error('Windows could not prepare the portable update. The current version is unchanged.')));
  child.once('spawn',()=>{child.unref();resolve();});
 });
}
export class DesktopUpdater{
 status:UpdateStatus={state:'idle',message:'',currentVersion:app.getVersion()};
 private pending?:UpdateRelease;
 constructor(private store:LibraryStore,private publish:(state:UpdateStatus)=>void,private services={latest,download,launch:async(file:string,target?:string)=>target?launchPortableUpdate(file,target):launchInstaller(file),finish:()=>{setTimeout(()=>app.quit(),150);},packaged:()=>app.isPackaged,portableFile:()=>process.env.PORTABLE_EXECUTABLE_FILE||''}){}
 private set(state:UpdateStatus['state'],message:string,progress?:number){this.status={state,message,progress,currentVersion:app.getVersion(),...(state==='available'&&this.pending?{version:this.pending.version,notes:this.pending.notes||'No release notes were provided for this version.'}:{})};this.publish(this.status);return this.status;}
 async check(){
  if(['checking','downloading','installing'].includes(this.status.state))return this.status;
  this.pending=undefined;this.set('checking','Checking GitHub for updates…');
  try{
   this.pending=await this.services.latest(app.getVersion(),undefined,this.services.portableFile()?'portable':'setup')||undefined;
   if(!this.pending)return this.set('current','You have the latest version.');
   return this.set('available','GameAtlas '+this.pending.version+' is available. Review the changes below before installing.');
  }catch(e){return this.set('error',e instanceof Error?e.message:'Could not check for updates. Try again.');}
 }
 dismiss(){
  if(this.status.state!=='available')return this.status;
  this.pending=undefined;return this.set('idle','Update postponed. You can check again whenever you’re ready.');
 }
 async install(version:string){
  if(this.status.state!=='available'||!this.pending||version!==this.pending.version)throw Error('Check for updates and review the release before installing.');
  const release=this.pending;this.pending=undefined;
  try{
   if(!this.services.packaged())throw Error('Install the packaged app to use automatic upgrades.');
   this.set('downloading','Downloading GameAtlas '+release.version+'…',0);
   const file=await this.services.download(release,join(app.getPath('userData'),'updates'),n=>this.set('downloading','Downloading GameAtlas '+release.version+'…',n));
   this.set('installing','Saving a safety backup and installing. GameAtlas will close and relaunch when finished.');
   this.store.snapshot('before-update-'+Date.now());
   const portable=this.services.portableFile();
   await this.services.launch(file,portable||undefined);this.services.finish();return this.status;
  }catch(e){return this.set('error',e instanceof Error?e.message:'The update failed. Check again to retry.');}
 }
}
