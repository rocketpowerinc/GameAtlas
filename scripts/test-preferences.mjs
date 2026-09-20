import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readdirSync,writeFileSync,utimesSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {LibraryStore}=require('../desktop-dist/store.cjs');
const {PreferencesStore}=require('../desktop-dist/preferences.cjs');
const {readBackup}=require('../desktop-dist/backup.cjs');
const root=mkdtempSync(join(tmpdir(),'gameatlas-prefs-'));let store;
try{
 store=new LibraryStore(root,resolve('data/library.json'));assert.equal(store.read().games.length,0);
 let prefs=new PreferencesStore(root,false);assert.equal(prefs.read().setupComplete,false);assert.equal(prefs.run(store,'change'),false);
 prefs=new PreferencesStore(root,true);assert.equal(prefs.read().setupComplete,false,'Unfinished setup survives restart');
 const folder=join(root,'chosen');prefs.configure({backupFolder:folder,backupMode:'manual'},true);
 assert.equal(prefs.run(store,'change'),false);assert.equal(prefs.run(store,'startup'),false);assert.equal(prefs.run(store,'timer'),false);
 prefs.configure({backupFolder:folder,backupMode:'changes'});
 const lib=store.read();store.save({...lib,games:[{id:'one',values:{Title:'New game'}}]},false);
 assert.equal(prefs.run(store,'change',new Date(2026,8,11,10)),true);
 assert.equal(prefs.run(store,'timer',new Date(2026,8,11,11)),false);
 const files=readdirSync(folder);assert.equal(files.length,1);assert.equal(readBackup(join(folder,files[0])).library.games[0].values.Title,'New game');
 prefs.configure({backupFolder:folder,backupMode:'daily'});
 assert.equal(prefs.run(store,'startup',new Date(2026,8,12,9)),true);
 assert.equal(prefs.run(store,'change',new Date(2026,8,12,10)),false);
 prefs=new PreferencesStore(root,true);assert.equal(prefs.run(store,'timer',new Date(2026,8,12,11)),false);
 assert.equal(prefs.run(store,'timer',new Date(2026,8,13,0,1)),true);
 prefs.configure({backupFolder:folder,backupMode:'manual'});assert.equal(prefs.run(store,'timer',new Date(2026,8,14)),false);

 // Retention combines scheduled and safety copies while preserving manual exports.
 const manual=join(folder,'gameatlas-backup-2026-09-01.gameatlas');
 writeFileSync(manual,'manual export');writeFileSync(join(folder,'notes.txt'),'unrelated');
 const oldSafety=join(store.backupDir,'before-update-1000.gameatlas');
 writeFileSync(oldSafety,'old safety');utimesSync(oldSafety,1,1);
 prefs.configure({backupFolder:folder,backupMode:'changes'});
 for(let i=0;i<15;i++){
  const when=new Date(2026,8,15,0,0,i);
  assert.equal(prefs.run(store,'change',when),true);
 }
 const generated=()=>[...readdirSync(folder).filter(n=>n.startsWith('gameatlas-')&&!n.startsWith('gameatlas-backup-')),
  ...readdirSync(store.backupDir).filter(n=>n.endsWith('.gameatlas'))];
 assert.equal(generated().length,10);assert.equal(existsSync(oldSafety),false);
 assert.equal(existsSync(manual),true);assert.equal(existsSync(join(folder,'notes.txt')),true);
 for(let i=0;i<12;i++)store.snapshot('before-restore-'+(2000+i));
 assert.equal(generated().length,10);
 assert.ok(existsSync(join(store.backupDir,'before-restore-2011.gameatlas')));
 for(const name of readdirSync(store.backupDir))if(name.endsWith('.gameatlas'))readBackup(join(store.backupDir,name));
 // Existing excess backups are cleaned on startup even with a manual schedule.
 for(let i=0;i<12;i++)writeFileSync(join(store.backupDir,'before-update-'+(3000+i)+'.gameatlas'),'old');
 prefs.configure({backupFolder:folder,backupMode:'manual'});
 assert.equal(prefs.run(store,'startup'),false);assert.equal(generated().length,10);
 // The same directory must not count twice.
 store.scheduledBackupDir=store.backupDir;store.pruneBackups();
 assert.equal(readdirSync(store.backupDir).filter(n=>n.endsWith('.gameatlas')).length,10);
 store.close();store=new LibraryStore(root,resolve('data/library.json'));assert.equal(store.read().games.length,1,'Upgrade preserves collection');
 writeFileSync(join(root,'settings.json'),JSON.stringify({backupFolder:folder}));
 const old=new PreferencesStore(root,true);assert.equal(old.read().setupComplete,true);assert.equal(old.read().backupFolder,folder);
 assert.throws(()=>old.configure({backupFolder:folder,backupMode:'hourly'}));
 assert.throws(()=>old.configure({backupFolder:'relative/path',backupMode:'daily'}));
 console.log('PASS: empty fresh library, resumable setup, existing-install migration, manual/changes/daily schedules, once-per-day persistence, selected-folder full backups, upgrade preservation.');
}finally{store?.close();rmSync(root,{recursive:true,force:true});}
