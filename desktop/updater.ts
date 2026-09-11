import {app} from 'electron';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {latest,download} from './update-core';
import type {LibraryStore} from './store';
export type UpdateStatus={state:'idle'|'checking'|'downloading'|'installing'|'current'|'error';message:string;currentVersion:string;progress?:number};
export async function launchInstaller(file:string){
 await new Promise<void>((resolve,reject)=>{
  const child=spawn(file,['--updated','/S','--force-run'],{detached:true,stdio:'ignore',windowsHide:true});
  child.once('error',()=>reject(Error('Windows could not start the installer. The current version is unchanged.')));
  child.once('spawn',()=>{child.unref();resolve();});
 });
}
export class DesktopUpdater{
 status:UpdateStatus={state:'idle',message:'',currentVersion:app.getVersion()};
 constructor(private store:LibraryStore,private publish:(state:UpdateStatus)=>void,private services={latest,download,launch:launchInstaller,finish:()=>{setTimeout(()=>app.quit(),150);},packaged:()=>app.isPackaged}){}
 private set(state:UpdateStatus['state'],message:string,progress?:number){this.status={state,message,progress,currentVersion:app.getVersion()};this.publish(this.status);return this.status;}
 async check(){
  if(['checking','downloading','installing'].includes(this.status.state))return this.status;
  this.set('checking','Checking GitHub for updates…');
  try{
   const release=await this.services.latest(app.getVersion());
   if(!release)return this.set('current','You have the latest version.');
   if(!this.services.packaged())return this.set('error','An update is available. Install the packaged app to use automatic upgrades.');
   const file=await this.services.download(release,join(app.getPath('userData'),'updates'),n=>this.set('downloading','Downloading GameAtlas '+release.version+'…',n));
   this.set('installing','Saving a safety backup and installing the update…');
   this.store.snapshot('before-update-'+Date.now());
   await this.services.launch(file);
   this.services.finish();return this.status;
  }catch(e){return this.set('error',e instanceof Error?e.message:'The update failed. Try again.');}
 }
}
