import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {newer,selectRelease,latest,download,repository}=require('../desktop-dist/update-core.cjs');
const bytes=Buffer.from('test installer payload');
const hash=createHash('sha256').update(bytes).digest('hex');
const release={tag_name:'v1.10.0',draft:false,prerelease:false,body:'New artwork workflow\nKeeps your collection.',assets:[{id:42,name:'GameAtlas.Setup.1.10.0.exe',state:'uploaded',size:bytes.length,digest:'sha256:'+hash},{id:43,name:'GameAtlas.Portable.1.10.0.exe',state:'uploaded',size:bytes.length,digest:'sha256:'+hash}]};
assert.ok(newer('1.10.0','1.9.9'));assert.ok(!newer('1.2.0','1.3.0'));assert.ok(!newer('1.3.0','1.3.0'));
assert.throws(()=>newer('not-a-version','1.0.0'));
assert.equal(selectRelease(release,'1.10.0'),null);
assert.equal(selectRelease({...release,prerelease:true},'1.0.0'),null);
assert.throws(()=>selectRelease({...release,assets:[]},'1.0.0'),/verified/);
assert.throws(()=>selectRelease({...release,assets:[{...release.assets[0],digest:null}]},'1.0.0'),/verified/);
assert.equal(selectRelease(release,'1.0.0','portable').flavor,'portable');
assert.equal(selectRelease(release,'1.0.0','portable').url,repository+'/releases/assets/43');
const selected=await latest('1.0.0',async(url,options)=>{
 assert.equal(url,repository+'/releases/latest');assert.equal(options.headers.Authorization,undefined);
 return Response.json(release);
});
assert.equal(selected.notes,release.body);
assert.equal(selectRelease({...release,body:null},'1.0.0').notes,'');
const directory=mkdtempSync(join(tmpdir(),'gameatlas-update-test-'));
try{
 let calls=0;
 const path=await download(selected,directory,()=>{},async(url,options)=>{
  assert.equal(options.headers.Authorization,undefined);calls++;
  if(calls===1)return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/example'}});
  assert.equal(url,'https://release-assets.githubusercontent.com/example');return new Response(bytes);
 });
 assert.equal(calls,2);assert.deepEqual(readFileSync(path),bytes);
 const before=readdirSync(directory).length;
 await assert.rejects(download(selected,directory,()=>{},async()=>new Response(Buffer.from('wrong'))),/integrity/);
 assert.equal(readdirSync(directory).length,before,'Bad download leaves no executable or partial');
 await assert.rejects(download(selected,directory,()=>{},async()=>new Response(null,{status:302,headers:{location:'https://example.com/installer.exe'}})),/unexpected/);
 await assert.rejects(latest('1.0.0',async()=>new Response('',{status:403})),/rate-limited/);
 if(process.argv.includes('--live')){
  const current=await latest('0.0.0');assert.ok(current);console.log('Public GitHub release available:',current.version);
  const file=await download(current,directory);
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),current.digest);
  console.log('PASS: real public GitHub installer download and SHA-256 verification.');
 }
 console.log('PASS: version ordering, no downgrades, release validation, public API access, redirect restrictions, verified downloads, corruption cleanup, and rate-limit errors.');
}finally{rmSync(directory,{recursive:true,force:true});}
