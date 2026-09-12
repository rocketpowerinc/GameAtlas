import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { writeBackup } from './backup';
import type { LibraryStore } from './store';
export type Preferences={setupComplete:boolean;backupFolder:string;backupMode:'changes'|'daily'|'manual';lastBackupDay?:string;lastBackupAt?:string;backupError?:string};
export class PreferencesStore{
 private settings:Preferences;
 private file:string;
 error='';
 constructor(readonly directory:string,existing:boolean){
  this.file=join(directory,'settings.json');
  const old=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{};
  this.settings={setupComplete:typeof old.setupComplete==='boolean'?old.setupComplete:existing,backupFolder:old.backupFolder||join(directory,'backups'),backupMode:['changes','daily','manual'].includes(old.backupMode)?old.backupMode:'changes',lastBackupDay:old.lastBackupDay,lastBackupAt:old.lastBackupAt};
  this.persist();
 }
 private persist(){mkdirSync(this.directory,{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.settings,null,2));renameSync(this.file+'.tmp',this.file);}
 read():Preferences{return {...this.settings,backupError:this.error};}
 configure(input:{backupFolder:string;backupMode:string},complete=false){
  if(!['changes','daily','manual'].includes(input.backupMode)||typeof input.backupFolder!=='string'||!isAbsolute(input.backupFolder)||input.backupFolder.includes('\0'))throw Error('Choose a backup folder and schedule.');
  const changed=input.backupFolder!==this.settings.backupFolder||input.backupMode!==this.settings.backupMode;
  this.settings={...this.settings,backupFolder:input.backupFolder,backupMode:input.backupMode as Preferences['backupMode'],setupComplete:this.settings.setupComplete||complete,lastBackupDay:changed?undefined:this.settings.lastBackupDay};
  this.persist();this.error='';return this.read();
 }
 run(store:LibraryStore,trigger:'startup'|'change'|'timer',date=new Date()){
  const p=this.settings;store.scheduledBackupDir=p.backupFolder;
  try{store.pruneBackups();}catch(e){this.error='Backup cleanup failed: '+(e instanceof Error?e.message:String(e));return false;}
  if(!p.setupComplete||p.backupMode==='manual')return false;
  const day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  if(p.backupMode==='changes'&&trigger!=='change'||p.backupMode==='daily'&&p.lastBackupDay===day)return false;
  try{
   const name='gameatlas-'+date.toISOString().replace(/[:.]/g,'-')+'-'+store.read().revision+'.gameatlas';
   writeBackup(store.db,store.directory,join(p.backupFolder,name));
   store.pruneBackups(join(p.backupFolder,name));
   this.settings={...p,lastBackupDay:day,lastBackupAt:date.toISOString()};this.persist();this.error='';return true;
  }catch(e){this.error='Backup could not be saved: '+(e instanceof Error?e.message:String(e));return false;}
 }
}
