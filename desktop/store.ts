import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validate, type Library } from '../lib/library';
import { writeBackup, type LoadedBackup } from './backup';
export class LibraryStore {
 db: DatabaseSync;
 backupDir: string;
 constructor(readonly directory:string,seed:string){
  mkdirSync(directory,{recursive:true});
  this.backupDir=join(directory,'backups');mkdirSync(this.backupDir,{recursive:true});
  this.db=new DatabaseSync(join(directory,'library.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL)');
  if(!this.db.prepare('SELECT id FROM library WHERE id=1').get()){
   const data=JSON.parse(readFileSync(seed,'utf8'));validate(data);
   this.db.prepare('INSERT INTO library VALUES (1,?,1)').run(JSON.stringify({fields:data.fields,games:data.games}));
  }
  this.recoverRestore();
  this.snapshot('daily-'+new Date().toISOString().slice(0,10));
 }
 read():Library{const row=this.db.prepare('SELECT data,revision FROM library WHERE id=1').get()!;return {...JSON.parse(String(row.data)),revision:Number(row.revision)};}
 snapshot(label='before-save-'+Date.now()+'-'+randomUUID()){
  const path=join(this.backupDir,label+'.gameatlas');if(existsSync(path))return;
  writeBackup(this.db,this.directory,path);
  for(const [prefix,keep] of [['before-save-',20],['daily-',7]] as const){
   const recent=readdirSync(this.backupDir).filter(n=>n.startsWith(prefix)&&n.endsWith('.gameatlas')).sort();
   for(const name of recent.slice(0,Math.max(0,recent.length-keep)))unlinkSync(join(this.backupDir,name));
  }
 }
 save(data:Library,snapshot=true):Library{
  validate(data);
  if(!Number.isSafeInteger(data.revision)||data.revision!==this.read().revision)throw Error('Your library changed. Reload before saving.');
  if(snapshot){this.snapshot('daily-'+new Date().toISOString().slice(0,10));this.snapshot();}
  const result=this.db.prepare('UPDATE library SET data=?, revision=revision+1 WHERE id=1 AND revision=?').run(JSON.stringify({fields:data.fields,games:data.games}),data.revision);
  if(!result.changes)throw Error('Your library changed. Reload before saving.');
  return this.read();
 }
 recoverRestore(){
  const journal=join(this.directory,'restore-journal.json');if(!existsSync(journal))return;
  const {token,revision}=JSON.parse(readFileSync(journal,'utf8'));
  if(!/^[a-f0-9-]{36}$/.test(token)||!Number.isSafeInteger(revision))throw Error('Invalid restore recovery record.');
  const old=join(this.directory,'restore-old-'+token),stage=join(this.directory,'restore-stage-'+token),art=join(this.directory,'artwork');
  if(this.read().revision===revision&&existsSync(old)){
   if(existsSync(art))rmSync(art,{recursive:true,force:true});renameSync(old,art);
  }
  for(const path of [old,stage])if(existsSync(path))rmSync(path,{recursive:true,force:true});
  unlinkSync(journal);
 }
 restore(backup:LoadedBackup):Library{
  validate(backup.library);
  // Preserve the old database and image bytes before any replacement.
  this.snapshot('before-restore-'+Date.now()+'-'+randomUUID());
  if(backup.summary.legacy)return this.save({...backup.library,revision:this.read().revision},false);
  const token=randomUUID(),art=join(this.directory,'artwork'),old=join(this.directory,'restore-old-'+token),stage=join(this.directory,'restore-stage-'+token);
  mkdirSync(stage);
  try{
   for(const image of backup.artwork){writeFileSync(join(stage,image.key),image.bytes);writeFileSync(join(stage,image.key+'.type'),image.mime);}
   mkdirSync(art,{recursive:true});
   const journal=join(this.directory,'restore-journal.json');
   writeFileSync(journal+'.tmp',JSON.stringify({token,revision:this.read().revision}));renameSync(journal+'.tmp',journal);
   renameSync(art,old);renameSync(stage,art);
   const restored=this.save({...backup.library,revision:this.read().revision},false);
   // A committed database revision lets startup recovery finish interrupted cleanup safely.
   try{this.recoverRestore();}catch{}
   return restored;
  }catch(e){this.recoverRestore();if(existsSync(stage))rmSync(stage,{recursive:true,force:true});throw e;}
 }
 close(){this.db.close();}
}
