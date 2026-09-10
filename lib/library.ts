export type Field = {id:string;name:string;type:'text'|'multi_select'|'number'|'date'|'url'|'checkbox';options:string[]};
export type Game = {id:string;values:Record<string,string|number|boolean|string[]>;sourceUrl?:string;dateEnd?:string;dateIsTime?:number;lookup?:{sources:{name:string;url:string}[];scoreSource?:string;releaseNote?:string;coverUrl?:string;description?:string}};
export type Library = {fields:Field[];games:Game[];revision:number};
export const display = (v:unknown):string => Array.isArray(v)?v.join(', '):v===undefined||v===null?'':String(v);
export function validate(data:unknown): asserts data is Library {
 if(!data||typeof data!=='object')throw new Error('Invalid library.');
 const d=data as Library;
 if(!Array.isArray(d.fields)||!Array.isArray(d.games)||d.fields.length>100||d.games.length>10000)throw new Error('Invalid library size.');
 if(new Set(d.fields.map(f=>f.id)).size!==d.fields.length||new Set(d.games.map(g=>g.id)).size!==d.games.length)throw new Error('Duplicate identifiers.');
 for(const f of d.fields){if(!f||typeof f.id!=='string'||!f.id||['__proto__','constructor','prototype'].includes(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.length>100||!['text','multi_select','number','date','url','checkbox'].includes(f.type)||!Array.isArray(f.options)||f.options.some(o=>typeof o!=='string'||o.length>200))throw new Error('Invalid property.');}
 for(const g of d.games){if(!g||typeof g.id!=='string'||!g.id||!g.values||typeof g.values!=='object'||Array.isArray(g.values))throw new Error('Invalid game.');for(const v of Object.values(g.values)){if(!(typeof v==='string'||typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'||Array.isArray(v)&&v.every(x=>typeof x==='string')))throw new Error('Invalid game value.');}}
 if(JSON.stringify(d).length>1800000)throw new Error('Library exceeds the current storage limit. Download a backup before adding more data.');
}
