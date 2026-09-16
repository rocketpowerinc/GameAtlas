import {normalizeTitle,type LookupCandidate,type LookupDetails} from '../lib/game-lookup';
import type {LibraryStore} from './store';

type Services={
 search:(title:string)=>Promise<{candidates:LookupCandidate[]}>;
 details:(candidate:LookupCandidate)=>Promise<LookupDetails>;
};
export type DescriptionScanResult={total:number;processed:number;added:number;missing:number};

export class DescriptionScan{
 constructor(private store:LibraryStore,private services:Services){}
 async run():Promise<DescriptionScanResult>{
  const library=this.store.read();
  const titleField=library.fields.find(field=>field.name.toLowerCase()==='title')?.id||'Title';
  const targets=library.games.filter(game=>!game.lookup?.description?.trim());
  let processed=0,added=0;
  for(const target of targets){
   try{
    const title=String(target.values[titleField]??'').trim();
    if(!title)continue;
    const result=await this.services.search(title);
    const exact=result.candidates.filter(candidate=>normalizeTitle(candidate.name)===normalizeTitle(title));
    if(exact.length!==1)continue;
    const details=await this.services.details(exact[0]);
    const description=details.description?.trim();
    if(!description)continue;
    const game=library.games.find(item=>item.id===target.id);
    if(!game||game.lookup?.description?.trim())continue;
    const sources=[...(game.lookup?.sources??[]),...details.sources].filter((source,index,all)=>all.findIndex(item=>item.url===source.url)===index);
    game.lookup={...game.lookup,sources,description};
    added++;
   }catch{}
   finally{processed++;}
  }
  if(added)this.store.save(library,false);
  return {total:targets.length,processed,added,missing:targets.length-added};
 }
}
