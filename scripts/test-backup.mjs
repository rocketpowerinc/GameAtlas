import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID,createHash } from 'node:crypto';
const require=createRequire(import.meta.url);
const { LibraryStore }=require('../desktop-dist/store.cjs');
const { writeBackup,readBackup,imageKey,pruneUnusedArtwork }=require('../desktop-dist/backup.cjs');
const root=mkdtempSync(join(tmpdir(),'gameatlas-full-test-'));
const source=join(root,'source'),target=join(root,'target'),file=join(root,'complete.gameatlas');
const seed=resolve('scripts/fixtures/library.json');
let a,b;
try{
 a=new LibraryStore(source,seed);
 let library=a.read();const hardwareUrl='https://local-art.gameatlas.invalid/'+'a'.repeat(64);
 library=a.save({...library,hardware:[{id:'hardware-1',name:'Test console',type:'Console',manufacturer:'Test maker',model:'Launch model',releaseDate:'2001-02-03',description:'A test console description.',notes:'Complete in box.',coverUrl:hardwareUrl}]},false);
 const url=library.games.find(g=>g.lookup?.coverUrl).lookup.coverUrl,key=imageKey(url),hardwareKey=imageKey(hardwareUrl);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8WQAAAAASUVORK5CYII=','base64');
 mkdirSync(join(source,'artwork'));writeFileSync(join(source,'artwork',key),bytes);writeFileSync(join(source,'artwork',key+'.type'),'image/png');
 const hardwareBytes=Buffer.from('hardware artwork bytes');writeFileSync(join(source,'artwork',hardwareKey),hardwareBytes);writeFileSync(join(source,'artwork',hardwareKey+'.type'),'image/png');
 const unusedKey='f'.repeat(64);writeFileSync(join(source,'artwork',unusedKey),Buffer.from('unused'));writeFileSync(join(source,'artwork',unusedKey+'.type'),'image/png');
 const summary=writeBackup(a.db,source,file);assert.equal(summary.hardware,1);assert.equal(summary.images,2);assert.ok(summary.missing.length>0);
 assert.equal(pruneUnusedArtwork(library,source),1);assert.equal(existsSync(join(source,'artwork',unusedKey)),false);assert.equal(existsSync(join(source,'artwork',unusedKey+'.type')),false);
 writeBackup(a.db,source,file); // Replacing an existing exported backup is atomic.
 const oldArchive=new DatabaseSync(file);const unusedBytes=Buffer.from('unused old backup artwork');oldArchive.prepare('INSERT INTO backup_artwork VALUES (?,?,?,?)').run(unusedKey,'image/png',createHash('sha256').update(unusedBytes).digest('hex'),unusedBytes);oldArchive.close();
 const backup=readBackup(file);assert.deepEqual(backup.library,library);assert.equal(backup.summary.hardware,1);assert.equal(backup.artwork.length,2);
 a.close();a=undefined;rmSync(source,{recursive:true,force:true});
 b=new LibraryStore(target,seed);
 const restored=b.restore(backup);assert.deepEqual(restored.games,library.games);assert.deepEqual(restored.hardware,library.hardware);assert.deepEqual(restored.fields,library.fields);
 assert.deepEqual(readFileSync(join(target,'artwork',key)),bytes);assert.equal(readFileSync(join(target,'artwork',key+'.type'),'utf8'),'image/png');
 assert.deepEqual(readFileSync(join(target,'artwork',hardwareKey)),hardwareBytes);assert.equal(readFileSync(join(target,'artwork',hardwareKey+'.type'),'utf8'),'image/png');
 b.close();b=new LibraryStore(target,seed);assert.deepEqual(b.read().games,library.games);assert.deepEqual(b.read().hardware,library.hardware);
 // An injected write failure must preserve both the old collection and old image bytes.
 const oldBytes=Buffer.from('old image');writeFileSync(join(target,'artwork',key),oldBytes);
 const save=b.save;b.save=()=>{throw Error('Injected database failure');};
 assert.throws(()=>b.restore(backup),/Injected/);b.save=save;
 assert.deepEqual(readFileSync(join(target,'artwork',key)),oldBytes);assert.deepEqual(b.read().games,library.games);
 // Simulate a process exit after the image folder swap but before the SQLite commit.
 const token=randomUUID(),old=join(target,'restore-old-'+token);
 writeFileSync(join(target,'restore-journal.json'),JSON.stringify({token,revision:b.read().revision}));
 renameSync(join(target,'artwork'),old);mkdirSync(join(target,'artwork'));writeFileSync(join(target,'artwork','incomplete'),'partial');
 b.close();b=new LibraryStore(target,seed);
 assert.deepEqual(readFileSync(join(target,'artwork',key)),oldBytes);assert.ok(!existsSync(join(target,'restore-journal.json')));
 // Legacy JSON imports remain supported and retain the existing image cache.
 const legacy=join(root,'legacy.json');writeFileSync(legacy,JSON.stringify({format:'gameatlas-v1',...library}));
 b.restore(readBackup(legacy));assert.deepEqual(readFileSync(join(target,'artwork',key)),oldBytes);
 // Tampering fails before the live library is touched.
 const corrupt=new DatabaseSync(file);corrupt.prepare('UPDATE backup_artwork SET bytes=?').run(Buffer.from('tampered'));corrupt.close();
 assert.throws(()=>readBackup(file),/damaged/);assert.deepEqual(b.read().games,library.games);
 const bad=join(root,'invalid.gameatlas');writeFileSync(bad,'not a backup');assert.throws(()=>readBackup(bad));
 console.log('PASS: self-contained full restore to a fresh installation, game and hardware metadata, exact image bytes, restart, write-failure rollback, interrupted restore recovery, legacy import, corruption rejection.');
}finally{a?.close();b?.close();rmSync(root,{recursive:true,force:true});}
