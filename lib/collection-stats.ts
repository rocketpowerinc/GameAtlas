import type {Library,Game} from './library';
export function collectionStats(library:Library,now=new Date()){
 const field=(name:string)=>library.fields.find(f=>f.name.toLowerCase()===name.toLowerCase())?.id||name;
 const own=field('Ownership'),status=field('Status'),tagField=field('Tags'),platform=field('Platform'),genre=field('Genre'),score=field('Score'),title=field('Title');
 const tags=(g:Game,id:string)=>[...new Set((Array.isArray(g.values[id])?g.values[id]:typeof g.values[id]==='string'?[g.values[id]]:[] as string[]).map(String).map(s=>s.trim()).filter(Boolean))];
 const has=(g:Game,id:string,value:string)=>tags(g,id).some(t=>t.toLowerCase()===value.toLowerCase());
 const owned=library.games.filter(g=>has(g,own,'Physical')||has(g,own,'Digital'));
 const completed=owned.filter(g=>has(g,status,'Complete'));
 const backlog=owned.filter(g=>(has(g,status,'Must Play')||has(g,status,'Backlog'))&&!has(g,status,'Complete')&&!has(g,status,'Currently Playing'));
 const playing=owned.filter(g=>has(g,status,'Currently Playing'));
 const mustPlay=owned.filter(g=>has(g,status,'Must Play')||has(g,tagField,'Must Play'));
 const replay=owned.filter(g=>has(g,status,'Replay')||has(g,tagField,'Replay'));
 const unspecified=owned.filter(g=>!tags(g,status).length);
 const wishlist=library.games.filter(g=>has(g,own,'Wish List'));
 const groups=(id:string,source=owned)=>{const map=new Map<string,Game[]>();for(const g of source)for(const label of tags(g,id).length?tags(g,id):['Not specified'])map.set(label,[...(map.get(label)||[]),g]);return [...map].map(([label,games])=>({label,games})).sort((a,b)=>b.games.length-a.games.length||a.label.localeCompare(b.label));};
 const rated=owned.flatMap(g=>{const v=g.values[score];if(typeof v!=='number'&&typeof v!=='string'||String(v).trim()==='')return [];const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=10?[{game:g,score:n,title:String(g.values[title]||'Untitled game')}]:[];}).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title));
 const backlogIds=new Set(backlog.map(g=>g.id));
 const unplayedRated=rated.filter(r=>backlogIds.has(r.game.id));
 const scores=new Map(rated.map(r=>[r.game.id,r.score]));
 const studio=field('Studio');
 const developers=groups(studio).filter(row=>row.label!=='Not specified').map(row=>{
  const numbers=row.games.flatMap(g=>scores.has(g.id)?[scores.get(g.id)!]:[]);
  return {...row,ratedCount:numbers.length,average:numbers.length?numbers.reduce((a,b)=>a+b,0)/numbers.length:null};
 });
 const noStudio=owned.filter(g=>!tags(g,studio).length);
 const priority=field('Wishlist Priority');
 const priorityNames=['Must have','Want soon','Someday'];
 const wishlistPriorities=[...priorityNames,...new Set(wishlist.flatMap(g=>tags(g,priority)).filter(p=>!priorityNames.includes(p)&&p!=='Not set').sort()),'Not set'].map(label=>({label,games:wishlist.filter(g=>label==='Not set'?!tags(g,priority).length||tags(g,priority).includes(label):tags(g,priority).includes(label))}));
 const dateField=field('Release Date');
 const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
 const releaseGroups={released:[] as Game[],upcoming:[] as Game[],unknown:[] as Game[]};
 for(const game of wishlist){
  const raw=String(game.values[dateField]||''),date=raw.slice(0,10);
  const parsed=new Date(date+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(raw)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)releaseGroups.unknown.push(game);
  else if(date>today)releaseGroups.upcoming.push(game);else releaseGroups.released.push(game);
 }
 return {unplayedRated,developers,noStudio,wishlistPriorities,releaseGroups,total:library.games,owned,completed,backlog,mustPlay,replay,playing,unspecified,wishlist,physical:owned.filter(g=>has(g,own,'Physical')),digital:owned.filter(g=>has(g,own,'Digital')),platforms:groups(platform),genres:groups(genre),rated,average:rated.length?rated.reduce((sum,g)=>sum+g.score,0)/rated.length:null,completion:owned.length?Math.round(completed.length/owned.length*100):0};
}
