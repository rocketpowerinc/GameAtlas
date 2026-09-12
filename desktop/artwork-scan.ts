import type {LookupCandidate,LookupDetails} from '../lib/game-lookup';
import {normalizeTitle} from '../lib/game-lookup';
import type {LibraryStore} from './store';
export type MissingThumbnail={id:string;title:string;platform:string;reason:string};
export type ArtworkScanStatus={running:boolean;total:number;processed:number;added:number;current:string;cancelled:boolean;missing:MissingThumbnail[];error?:string};
type Services={cached:(url:string)=>boolean;download:(url:string)=>Promise<void>;search:(title:string)=>Promise<{candidates:LookupCandidate[]}>;details:(candidate:LookupCandidate)=>Promise<LookupDetails>};
export class ArtworkScan{
 status:ArtworkScanStatus={running:false,total:0,processed:0,added:0,current:'',cancelled:false,missing:[]};
 private cancelled=false;
 constructor(private store:LibraryStore,private services:Services){}
 missing():MissingThumbnail[]{
  const library=this.store.read(),title=library.fields.find(f=>f.name.toLowerCase()==='title')?.id||'Title',platform=library.fields.find(f=>f.name.toLowerCase()==='platform')?.id||'Platform';
  return library.games.filter(g=>!g.lookup?.coverUrl||!this.services.cached(g.lookup.coverUrl)).map(g=>({id:g.id,title:String(g.values[title]||'Untitled game'),platform:String(g.values[platform]||''),reason:'No downloaded thumbnail'}));
 }
 read(){return {...this.status,missing:this.status.running?this.status.missing:this.missing().map(g=>({...g,reason:this.status.missing.find(m=>m.id===g.id)?.reason||g.reason}))};}
 cancel(){this.cancelled=true;}
 async apply(id:string,url:string){
  if(typeof id!=='string'||typeof url!=='string'||url.length>3000)throw Error('Invalid artwork selection.');
  const before=this.store.read().games.find(g=>g.id===id);if(!before)throw Error('Game no longer exists.');
  await this.services.download(url);
  const library=this.store.read(),game=library.games.find(g=>g.id===id);if(!game)throw Error('Game no longer exists.');
  // Only the artwork reference changes; all vetted properties and lookup metadata stay intact.
  game.lookup={...game.lookup,sources:game.lookup?.sources||[],coverUrl:url};
  this.store.save(library,false);
 }
 async run(){
  if(this.status.running)throw Error('An artwork scan is already running.');
  const targets=this.missing();this.cancelled=false;
  this.status={running:true,total:targets.length,processed:0,added:0,current:'',cancelled:false,missing:[]};
  try{
   if(targets.length)this.store.snapshot();
   for(const target of targets){
    if(this.cancelled)break;
    this.status.current=target.title;let reason='No matching artwork found.';
    try{
     const game=this.store.read().games.find(g=>g.id===target.id);
     if(!game){this.status.processed++;continue;}
     const old=game.lookup?.coverUrl;
     let recovered=false;
     if(old){try{await this.services.download(old);recovered=true;}catch{}}
     if(!recovered&&!this.cancelled){
      const result=await this.services.search(target.title);
      if(this.cancelled)break;
      const exact=result.candidates.filter(c=>normalizeTitle(c.name)===normalizeTitle(target.title));
      if(exact.length!==1)reason=exact.length>1?'Multiple matching titles — choose the right edition.':'Choose a match or select an image file.';
      else{
       const details=await this.services.details(exact[0]);
       if(this.cancelled)break;
       if(details.coverUrl){await this.apply(target.id,details.coverUrl);recovered=true;}
      }
     }
     if(recovered)this.status.added++;
     else this.status.missing.push({...target,reason});
    }catch{this.status.missing.push({...target,reason:'The source was unavailable or had no usable image. Try a different match or image file.'});}
    this.status.processed++;
   }
  }catch(e){this.status.error=e instanceof Error?e.message:String(e);}
  finally{this.status.running=false;this.status.current='';this.status.cancelled=this.cancelled;}
  return this.read();
 }
}
