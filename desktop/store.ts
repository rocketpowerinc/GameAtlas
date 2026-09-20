import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, realpathSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validate, type Library } from '../lib/library';
import { writeBackup, type LoadedBackup } from './backup';
export class LibraryStore {
 db: DatabaseSync;
 backupDir: string;
 scheduledBackupDir?:string;
 constructor(readonly directory:string,seed:string){
  mkdirSync(directory,{recursive:true});
  this.backupDir=join(directory,'backups');mkdirSync(this.backupDir,{recursive:true});
  this.db=new DatabaseSync(join(directory,'library.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL)');
  if(!this.db.prepare('SELECT id FROM library WHERE id=1').get()){
   const data=JSON.parse(readFileSync(seed,'utf8'));validate(data);
   this.db.prepare('INSERT INTO library VALUES (1,?,1)').run(JSON.stringify({fields:data.fields,games:data.games,hardware:data.hardware??[]}));
  }
  this.recoverRestore();
 }
 read():Library{const row=this.db.prepare('SELECT data,revision FROM library WHERE id=1').get()!;return {...JSON.parse(String(row.data)),revision:Number(row.revision)};}
 snapshot(label='before-save-'+Date.now()+'-'+randomUUID()){
  const path=join(this.backupDir,label+'.gameatlas');if(existsSync(path))return;
  writeBackup(this.db,this.directory,path);
  this.pruneBackups(path);
 }
 pruneBackups(newest?:string){
  // Only app-generated names participate; manual exports and unrelated files are untouched.
  const generated=/^(?:gameatlas-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+|before-(?:save|restore|update)-\d+(?:-[a-f0-9-]{36})?|daily-\d{4}-\d{2}-\d{2})\.gameatlas$/;
  const folders=new Set([this.backupDir,this.scheduledBackupDir].filter((p):p is string=>!!p&&existsSync(p)).map(p=>realpathSync(p)));
  const backups=[...folders].flatMap(folder=>readdirSync(folder,{withFileTypes:true})
   .filter(entry=>entry.isFile()&&generated.test(entry.name))
   .map(entry=>{const path=join(folder,entry.name);return {path,time:statSync(path).mtimeMs};}));
  const protectedPath=newest?realpathSync(newest):undefined;
  backups.sort((a,b)=>Number(b.path===protectedPath)-Number(a.path===protectedPath)||b.time-a.time||b.path.localeCompare(a.path));
  for(const backup of backups.slice(10))unlinkSync(backup.path);
 }
 save(data:Library,snapshot=true):Library{
  validate(data);
  if(!Number.isSafeInteger(data.revision)||data.revision!==this.read().revision)throw Error('Your library changed. Reload before saving.');
  if(snapshot){this.snapshot('daily-'+new Date().toISOString().slice(0,10));this.snapshot();}
  const result=this.db.prepare('UPDATE library SET data=?, revision=revision+1 WHERE id=1 AND revision=?').run(JSON.stringify({fields:data.fields,games:data.games,hardware:data.hardware??[]}),data.revision);
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
