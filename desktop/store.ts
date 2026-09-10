import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validate, type Library } from '../lib/library';
export class LibraryStore {
 db: DatabaseSync;
 backupDir: string;
 constructor(readonly directory: string, seed: string) {
  mkdirSync(directory,{recursive:true});
  this.backupDir=join(directory,'backups'); mkdirSync(this.backupDir,{recursive:true});
  this.db=new DatabaseSync(join(directory,'library.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS library (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, revision INTEGER NOT NULL)');
  if(!this.db.prepare('SELECT id FROM library WHERE id=1').get()){
   const data=JSON.parse(readFileSync(seed,'utf8')); validate(data);
   this.db.prepare('INSERT INTO library VALUES (1,?,1)').run(JSON.stringify({fields:data.fields,games:data.games}));
  }
  this.snapshot('daily-'+new Date().toISOString().slice(0,10));
 }
 read():Library {const row=this.db.prepare('SELECT data,revision FROM library WHERE id=1').get()!; return {...JSON.parse(String(row.data)),revision:Number(row.revision)};}
 snapshot(label='before-save-'+Date.now()+'-'+crypto.randomUUID()){
  const path=join(this.backupDir,label+'.json'); if(existsSync(path))return;
  writeFileSync(path+'.tmp',JSON.stringify({format:'gameatlas-v1',...this.read()},null,2)); renameSync(path+'.tmp',path);
  const recent=readdirSync(this.backupDir).filter(n=>n.startsWith('before-save-')&&n.endsWith('.json')).sort();
  for(const name of recent.slice(0,Math.max(0,recent.length-100)))unlinkSync(join(this.backupDir,name));
 }
 save(data:Library):Library {
  validate(data);
  if(!Number.isSafeInteger(data.revision)||data.revision!==this.read().revision)throw new Error('Your library changed. Reload before saving.');
  this.snapshot('daily-'+new Date().toISOString().slice(0,10));
  this.snapshot();
  const result=this.db.prepare('UPDATE library SET data=?, revision=revision+1 WHERE id=1 AND revision=?').run(JSON.stringify({fields:data.fields,games:data.games}),data.revision);
  if(!result.changes)throw new Error('Your library changed. Reload before saving.');
  return this.read();
 }
 close(){this.db.close();}
}
