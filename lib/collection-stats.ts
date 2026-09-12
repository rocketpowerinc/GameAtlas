import type {Library,Game} from './library';
export function collectionStats(library:Library){
 const field=(name:string)=>library.fields.find(f=>f.name.toLowerCase()===name.toLowerCase())?.id||name;
 const own=field('Ownership'),status=field('Status'),platform=field('Platform'),genre=field('Genre'),score=field('Score'),title=field('Title');
 const tags=(g:Game,id:string)=>[...new Set((Array.isArray(g.values[id])?g.values[id]:typeof g.values[id]==='string'?[g.values[id]]:[] as string[]).map(String).map(s=>s.trim()).filter(Boolean))];
 const has=(g:Game,id:string,value:string)=>tags(g,id).some(t=>t.toLowerCase()===value.toLowerCase());
 const owned=library.games.filter(g=>has(g,own,'Physical')||has(g,own,'Digital'));
 const completed=owned.filter(g=>has(g,status,'Complete'));
 const backlog=owned.filter(g=>has(g,status,'Backlog')&&!has(g,status,'Complete')&&!has(g,status,'Currently Playing'));
 const playing=owned.filter(g=>has(g,status,'Currently Playing'));
 const unspecified=owned.filter(g=>!tags(g,status).length);
 const wishlist=library.games.filter(g=>has(g,own,'Wish List'));
 const groups=(id:string)=>{const map=new Map<string,Game[]>();for(const g of owned)for(const label of tags(g,id).length?tags(g,id):['Not specified'])map.set(label,[...(map.get(label)||[]),g]);return [...map].map(([label,games])=>({label,games})).sort((a,b)=>b.games.length-a.games.length||a.label.localeCompare(b.label));};
 const rated=owned.flatMap(g=>{const v=g.values[score];if(typeof v!=='number'&&typeof v!=='string'||String(v).trim()==='')return [];const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=10?[{game:g,score:n,title:String(g.values[title]||'Untitled game')}]:[];}).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title));
 return {total:library.games,owned,completed,backlog,playing,unspecified,wishlist,physical:owned.filter(g=>has(g,own,'Physical')),digital:owned.filter(g=>has(g,own,'Digital')),platforms:groups(platform),genres:groups(genre),rated,average:rated.length?rated.reduce((sum,g)=>sum+g.score,0)/rated.length:null,completion:owned.length?Math.round(completed.length/owned.length*100):0};
}
