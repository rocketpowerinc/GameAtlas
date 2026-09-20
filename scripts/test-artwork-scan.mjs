import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {LibraryStore}=require('../desktop-dist/store.cjs');
const {ArtworkScan}=require('../desktop-dist/artwork-scan.cjs');
const root=mkdtempSync(join(tmpdir(),'gameatlas-artwork-'));let store;
try{
 store=new LibraryStore(root,resolve('data/library.json'));
 const titles=['Already cached','Retry link','Exact match','Ambiguous','No results','Bad download'];
 const games=titles.map((title,i)=>({id:String(i),values:{Title:title,Score:9,Platform:['PC'],Link:'https://www.ign.com/games/vetted'},lookup:{sources:[{name:'Vetted',url:'https://www.ign.com/games/vetted'}],description:'Keep this description',coverUrl:i<2?'https://example/'+i:undefined}}));
 store.save({...store.read(),games},false);
 const original=structuredClone(store.read());
 const cached=new Set(['https://example/0']);const searched=[];
 const services={
  cached:url=>cached.has(url),
  download:async url=>{if(url.includes('bad'))throw Error('Network error');cached.add(url);},
  search:async title=>{searched.push(title);return {candidates:title==='No results'?[]:title==='Ambiguous'?[{name:title,wikiId:1},{name:title,wikiId:2}]:[{name:title,wikiId:3}]};},
  details:async c=>({values:{Title:'Never replace',Score:1},sources:[],description:'Never replace',coverUrl:c.name==='Bad download'?'https://example/bad':'https://example/exact'})
 };
 const scan=new ArtworkScan(store,services);
 assert.equal(scan.read().missing.length,5);
 const result=await scan.run();
 assert.equal(result.total,5);assert.equal(result.processed,5);assert.equal(result.added,2);assert.equal(result.missing.length,3);
 assert.deepEqual(searched,['Exact match','Ambiguous','No results','Bad download']);
 const saved=store.read();
 for(let i=0;i<games.length;i++){assert.deepEqual(saved.games[i].values,original.games[i].values);assert.equal(saved.games[i].lookup.description,original.games[i].lookup.description);assert.deepEqual(saved.games[i].lookup.sources,original.games[i].lookup.sources);}
 assert.equal(saved.games[2].lookup.coverUrl,'https://example/exact');
 assert.equal(saved.games[3].lookup.coverUrl,undefined);
 await assert.rejects(()=>scan.apply('3','https://example/bad'));
 assert.equal(store.read().games[3].lookup.coverUrl,undefined);
 await scan.apply('3','https://example/manual');
 assert.equal(scan.read().missing.length,2);
 await assert.rejects(()=>scan.apply('deleted','https://example/manual'));
 const cancelling=new ArtworkScan(store,{...services,search:async()=>{cancelling.cancel();return {candidates:[{name:'No results',wikiId:3}]};}});
 const cancelled=await cancelling.run();assert.equal(cancelled.cancelled,true);assert.equal(cancelled.added,0);assert.equal(cancelled.missing.length,2);
 const failing=new ArtworkScan(store,{...services,search:async()=>{throw Error('Offline');}});
 assert.equal((await failing.run()).missing.length,2);
 services.search=async title=>({candidates:[{name:title,wikiId:3}]});
 services.details=async()=>({values:{},sources:[],coverUrl:'https://example/bad',coverUrls:['https://example/fallback']});
 assert.equal((await new ArtworkScan(store,services).run()).added,2,'Fallback covers recover when the first image fails');
 assert.equal(scan.read().missing.length,0);
 console.log('PASS: missing artwork detection, cached skips, retry, exact and ambiguous matches, metadata preservation, manual choices, failed downloads, cancellation, offline recovery.');
}finally{store?.close();rmSync(root,{recursive:true,force:true});}

