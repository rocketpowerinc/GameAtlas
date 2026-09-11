import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {LibraryStore}=require('../desktop-dist/store.cjs');
const {readBackup}=require('../desktop-dist/backup.cjs');
const dir=mkdtempSync(join(tmpdir(),'gameatlas-store-test-'));
let store;
try{
 store=new LibraryStore(dir,resolve('scripts/fixtures/library.json'));
 const original=store.read();assert.equal(original.games.length,3);
 const seed=JSON.parse(readFileSync('scripts/fixtures/library.json','utf8'));assert.deepEqual(original.fields,seed.fields);assert.deepEqual(original.games,seed.games);
 const edited=structuredClone(original);edited.games[0].values.Title='Persistence test';
 const saved=store.save(edited);assert.equal(saved.revision,2);
 assert.throws(()=>store.save(edited),/changed/);
 const invalid=structuredClone(saved);invalid.games.push(invalid.games[0]);assert.throws(()=>store.save(invalid),/Duplicate/);
 store.close();store=new LibraryStore(dir,resolve('scripts/fixtures/library.json'));assert.equal(store.read().games[0].values.Title,'Persistence test');
 const snapshots=readdirSync(store.backupDir).filter(x=>x.startsWith('before-save-'));
 assert.equal(snapshots.length,1);const backup=readBackup(join(store.backupDir,snapshots[0])).library;
 assert.deepEqual(backup.games,original.games);
 const restored=store.save({...backup,revision:store.read().revision});assert.deepEqual(restored.games,original.games);
 console.log('PASS: 3-game migration, persistence, revision conflicts, validation, automatic backup, restore.');
}finally{store?.close();rmSync(dir,{recursive:true,force:true});}
