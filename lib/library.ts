import {decodeHtml} from './game-lookup';
export type Field = {id:string;name:string;type:'text'|'multi_select'|'number'|'date'|'url'|'checkbox';options:string[]};
export type Game = {id:string;values:Record<string,string|number|boolean|string[]>;esrb?:{url:string;title:string;platforms:string[];checkedAt:string};sourceUrl?:string;lookup?:{sources:{name:string;url:string}[];scoreSource?:string;releaseNote?:string;coverUrl?:string;description?:string}};
export type Library = {fields:Field[];games:Game[];revision:number};
export const display = (v:unknown):string => Array.isArray(v)?v.join(', '):v===undefined||v===null?'':String(v);
export function dedupeSources(sources:NonNullable<Game['lookup']>['sources']|undefined){
 const byName=new Map<string,{name:string;url:string}>();
 for(const source of sources??[]){if(typeof source?.name!=='string'||typeof source?.url!=='string'||!source.name.trim()||!source.url.trim())continue;const key=source.name.trim().toLowerCase();if(byName.has(key))byName.delete(key);byName.set(key,{name:source.name.trim(),url:source.url.trim()});}
 const byUrl=new Map<string,{name:string;url:string}>();
 for(const source of byName.values()){if(byUrl.has(source.url))byUrl.delete(source.url);byUrl.set(source.url,source);}
 return [...byUrl.values()];
}
const sourceOrder=['youtube','ign','steam','wikipedia','howlongtobeat','pricecharting'];
export function orderedSources(sources:NonNullable<Game['lookup']>['sources']|undefined){return dedupeSources(sources).map((source,index)=>({source,index,rank:sourceOrder.indexOf(source.name.trim().toLowerCase())})).sort((a,b)=>(a.rank<0?sourceOrder.length:a.rank)-(b.rank<0?sourceOrder.length:b.rank)||a.index-b.index).map(item=>item.source);}
export function preferredSourceUrl(sources:NonNullable<Game['lookup']>['sources']|undefined){
 const order=['ign','youtube','wikipedia','howlongtobeat'];
 for(const name of order){const source=dedupeSources(sources).find(item=>item.name.trim().toLowerCase()===name);if(source?.url)return source.url;}
 return '';
}
const sourceName=(raw:string)=>{try{const host=new URL(raw).hostname.toLowerCase();if(host==='youtu.be'||host.endsWith('youtube.com'))return 'YouTube';if(host.endsWith('ign.com'))return 'IGN';if(host.endsWith('wikipedia.org'))return 'Wikipedia';if(host.endsWith('howlongtobeat.com'))return 'HowLongToBeat';if(host.endsWith('pricecharting.com'))return 'PriceCharting';if(host.endsWith('steampowered.com'))return 'Steam';}catch{}return 'Website';};
export function withCurrentLibraryShape(library:Library):Library{
 const next=structuredClone(library),retired=new Set(next.fields.filter(field=>['link','target price'].includes(field.name.trim().toLowerCase())||['link','target price'].includes(field.id.trim().toLowerCase())).map(field=>field.id));
 const linkIds=next.fields.filter(field=>field.name.trim().toLowerCase()==='link'||field.id.trim().toLowerCase()==='link').map(field=>field.id);
 const priority=next.fields.find(field=>field.name.trim().toLowerCase()==='wishlist priority'||field.id.trim().toLowerCase()==='wishlist priority');
 next.fields=next.fields.filter(field=>!retired.has(field.id)).map(field=>field.id===priority?.id?{...field,options:field.options.filter(option=>option.trim().toLowerCase()!=='want soon')}:field);
 for(const game of next.games){
  for(const id of linkIds){const url=typeof game.values[id]==='string'?game.values[id].trim():'';if(/^https?:\/\//i.test(url)){const sources=game.lookup?.sources??[];if(!sources.some(source=>source.url===url))game.lookup={...game.lookup,sources:[...sources,{name:sourceName(url),url}]};}}
  if(game.lookup)game.lookup={...game.lookup,sources:dedupeSources(game.lookup.sources.map(source=>sourceName(source.url)==='PriceCharting'?{...source,name:'PriceCharting'}:source))};
  if(game.lookup?.description)game.lookup.description=decodeHtml(game.lookup.description);
  for(const id of retired)delete game.values[id];
  if(priority){const value=game.values[priority.id];if(Array.isArray(value))game.values[priority.id]=value.filter(option=>option.trim().toLowerCase()!=='want soon');else if(typeof value==='string'&&value.trim().toLowerCase()==='want soon')game.values[priority.id]='';}
  delete (game as Game&{dateEnd?:string}).dateEnd;delete (game as Game&{dateIsTime?:number}).dateIsTime;
 }
 return next;
}
export function validate(data:unknown): asserts data is Library {
 if(!data||typeof data!=='object')throw new Error('Invalid library.');
 const d=data as Library;
 if(!Array.isArray(d.fields)||!Array.isArray(d.games)||d.fields.length>100||d.games.length>10000)throw new Error('Invalid library size.');
 if(new Set(d.fields.map(f=>f.id)).size!==d.fields.length||new Set(d.games.map(g=>g.id)).size!==d.games.length)throw new Error('Duplicate identifiers.');
 for(const f of d.fields){if(!f||typeof f.id!=='string'||!f.id||['__proto__','constructor','prototype'].includes(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.length>100||!['text','multi_select','number','date','url','checkbox'].includes(f.type)||!Array.isArray(f.options)||f.options.some(o=>typeof o!=='string'||o.length>200))throw new Error('Invalid property.');}
 for(const g of d.games){if(!g||typeof g.id!=='string'||!g.id||!g.values||typeof g.values!=='object'||Array.isArray(g.values))throw new Error('Invalid game.');for(const v of Object.values(g.values)){if(!(typeof v==='string'||typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'||Array.isArray(v)&&v.every(x=>typeof x==='string')))throw new Error('Invalid game value.');}}
 if(JSON.stringify(d).length>1800000)throw new Error('Library exceeds the current storage limit. Download a backup before adding more data.');
}
