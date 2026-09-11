import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);
const { LibraryStore }=require('../desktop-dist/store.cjs');
const { writeBackup,readBackup,imageKey }=require('../desktop-dist/backup.cjs');
const root=mkdtempSync(join(tmpdir(),'gameatlas-full-test-'));
const source=join(root,'source'),target=join(root,'target'),file=join(root,'complete.gameatlas');
const seed=resolve('data/library.json');
let a,b;
try{
 a=new LibraryStore(source,seed);
 const library=a.read();const url=library.games.find(g=>g.lookup?.coverUrl).lookup.coverUrl,key=imageKey(url);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8WQAAAAASUVORK5CYII=','base64');
 mkdirSync(join(source,'artwork'));writeFileSync(join(source,'artwork',key),bytes);writeFileSync(join(source,'artwork',key+'.type'),'image/png');
 const summary=writeBackup(a.db,source,file);assert.equal(summary.images,1);assert.ok(summary.missing.length>0);
 writeBackup(a.db,source,file); // Replacing an existing exported backup is atomic.
 const backup=readBackup(file);assert.deepEqual(backup.library,library);assert.equal(backup.artwork.length,1);
 a.close();a=undefined;rmSync(source,{recursive:true,force:true});
 b=new LibraryStore(target,seed);
 const restored=b.restore(backup);assert.deepEqual(restored.games,library.games);assert.deepEqual(restored.fields,library.fields);
 assert.deepEqual(readFileSync(join(target,'artwork',key)),bytes);assert.equal(readFileSync(join(target,'artwork',key+'.type'),'utf8'),'image/png');
 b.close();b=new LibraryStore(target,seed);assert.deepEqual(b.read().games,library.games);
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
 console.log('PASS: self-contained full restore to a fresh installation, all metadata, exact image bytes, restart, write-failure rollback, interrupted restore recovery, legacy import, corruption rejection.');
}finally{a?.close();b?.close();rmSync(root,{recursive:true,force:true});}
