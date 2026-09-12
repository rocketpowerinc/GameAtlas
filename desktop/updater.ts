import {app} from 'electron';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
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
export class DesktopUpdater{
 status:UpdateStatus={state:'idle',message:'',currentVersion:app.getVersion()};
 private pending?:UpdateRelease;
 constructor(private store:LibraryStore,private publish:(state:UpdateStatus)=>void,private services={latest,download,launch:launchInstaller,finish:()=>{setTimeout(()=>app.quit(),150);},packaged:()=>app.isPackaged}){}
 private set(state:UpdateStatus['state'],message:string,progress?:number){this.status={state,message,progress,currentVersion:app.getVersion(),...(state==='available'&&this.pending?{version:this.pending.version,notes:this.pending.notes||'No release notes were provided for this version.'}:{})};this.publish(this.status);return this.status;}
 async check(){
  if(['checking','downloading','installing'].includes(this.status.state))return this.status;
  this.pending=undefined;this.set('checking','Checking GitHub for updates…');
  try{
   this.pending=await this.services.latest(app.getVersion())||undefined;
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
   await this.services.launch(file);this.services.finish();return this.status;
  }catch(e){return this.set('error',e instanceof Error?e.message:'The update failed. Check again to retry.');}
 }
}
