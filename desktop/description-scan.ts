import type {LibraryStore} from './store';

export const missingDescriptionText='No description has been added for this game yet.';
export type MissingDescription={id:string;title:string;platform:string};

export class DescriptionScan{
 constructor(private store:LibraryStore){}
 missing():MissingDescription[]{
  return this.store.read().games.filter(game=>{
   const description=game.lookup?.description?.trim()||'';
   return !description||description===missingDescriptionText;
  }).map(game=>({
   id:game.id,
   title:String(game.values.Title||'Untitled game'),
   platform:Array.isArray(game.values.Platform)?game.values.Platform.join(', '):String(game.values.Platform||'Platform not set')
  })).sort((a,b)=>a.title.localeCompare(b.title));
 }
 apply(id:string,description:string){
  const clean=description.trim();
  if(!clean||clean===missingDescriptionText)throw Error('Enter a description for this game.');
  const library=this.store.read(),game=library.games.find(item=>item.id===id);
  if(!game)throw Error('Game no longer exists.');
  game.lookup={...game.lookup,sources:game.lookup?.sources||[],description:clean};
  this.store.save(library,false);
 }
}
