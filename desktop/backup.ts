import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { openSync, closeSync, readSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validate, type Library } from '../lib/library';
export const imageKey=(url:string)=>createHash('sha256').update(url).digest('hex');
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const types=new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
const referencedArtwork=(library:Library)=>new Set([...library.games.map(game=>game.lookup?.coverUrl),...(library.hardware??[]).map(item=>item.coverUrl)].filter((url):url is string=>!!url).map(imageKey));
export type BackupSummary={games:number;hardware:number;images:number;missing:string[];createdAt:string;legacy:boolean};
export function missingArtwork(library:Library,directory:string):string[]{
 return [...new Set([...library.games.map(g=>g.lookup?.coverUrl),...(library.hardware??[]).map(item=>item.coverUrl)].filter((u):u is string=>!!u))].filter(url=>{
  const path=join(directory,'artwork',imageKey(url));
  return !existsSync(path)||!existsSync(path+'.type');
 });
}
export function pruneUnusedArtwork(library:Library,directory:string):number{
 const art=join(directory,'artwork');if(!existsSync(art))return 0;
 const referenced=referencedArtwork(library);let removed=0;
 for(const name of readdirSync(art)){
  const key=/^[a-f0-9]{64}$/.test(name)?name:/^([a-f0-9]{64})\.type$/.exec(name)?.[1];
  if(!key)continue;
  const image=join(art,key),type=image+'.type';
  if(!referenced.has(key)){
   if(existsSync(image)){rmSync(image,{force:true});removed++;}
   if(existsSync(type))rmSync(type,{force:true});
  }else if(name.endsWith('.type')&&!existsSync(image))rmSync(type,{force:true});
 }
 return removed;
}
export function writeBackup(db:DatabaseSync,directory:string,destination:string):BackupSummary{
 mkdirSync(dirname(destination),{recursive:true});
 const temp=destination+'.'+randomUUID()+'.tmp';let archive:DatabaseSync|undefined;
 try{
  // VACUUM INTO captures committed SQLite data, including WAL contents, without copying a live WAL file.
  db.exec("VACUUM INTO '"+temp.replaceAll("'","''")+"'");
  archive=new DatabaseSync(temp);
  const row=archive.prepare('SELECT data,revision FROM library WHERE id=1').get()!;
  const library={...JSON.parse(String(row.data)),revision:Number(row.revision)};validate(library);
  const referenced=referencedArtwork(library);
  archive.exec('CREATE TABLE backup_manifest (data TEXT NOT NULL); CREATE TABLE backup_artwork (key TEXT PRIMARY KEY, mime TEXT NOT NULL, digest TEXT NOT NULL, bytes BLOB NOT NULL)');
  const put=archive.prepare('INSERT INTO backup_artwork VALUES (?,?,?,?)');
  const art=join(directory,'artwork');let images=0,totalBytes=0;
  archive.exec('BEGIN');
  if(existsSync(art))for(const key of readdirSync(art)){
   if(!referenced.has(key)||!existsSync(join(art,key+'.type')))continue;
   const mime=readFileSync(join(art,key+'.type'),'utf8');if(!types.has(mime))throw Error('An artwork file has an unsupported format.');
   const bytes=readFileSync(join(art,key));if(bytes.length>10_000_000)throw Error('An artwork file is too large.');
   totalBytes+=bytes.length;if(images>=10000||totalBytes>1_000_000_000)throw Error('Artwork exceeds the 1 GB backup limit.');
   put.run(key,mime,digest(bytes),bytes);images++;
  }
  const missing=missingArtwork(library,directory);
  const summary={games:library.games.length,hardware:(library.hardware??[]).length,images,missing,createdAt:new Date().toISOString(),legacy:false};
  archive.prepare('INSERT INTO backup_manifest VALUES (?)').run(JSON.stringify({format:'gameatlas-full',version:1,...summary,libraryDigest:digest(String(row.data))}));
  archive.exec('COMMIT');archive.close();archive=undefined;
  renameSync(temp,destination);
  return summary;
 }finally{archive?.close();if(existsSync(temp))rmSync(temp,{force:true});}
}
export type LoadedBackup={library:Library;summary:BackupSummary;artwork:{key:string;mime:string;bytes:Uint8Array}[]};
export function readBackup(path:string):LoadedBackup {
 if(statSync(path).size>2_000_000_000)throw Error('Backup exceeds the 2 GB limit.');
 const header=Buffer.alloc(16);const fd=openSync(path,'r');try{readSync(fd,header,0,16,0);}finally{closeSync(fd);}
 if(header.toString()!=='SQLite format 3\0'){
  if(statSync(path).size>1_800_000)throw Error('This is not a supported GameAtlas backup.');
  const data=JSON.parse(readFileSync(path,'utf8'));if(data.format!=='gameatlas-v1')throw Error('Choose a GameAtlas backup.');
  validate(data);return {library:data,artwork:[],summary:{games:data.games.length,hardware:(data.hardware??[]).length,images:0,missing:[],createdAt:'',legacy:true}};
 }
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('The backup is damaged.');
  for(const name of ['library','backup_manifest','backup_artwork']){
   if(db.prepare("SELECT type FROM sqlite_master WHERE name=?").get(name)?.type!=='table')throw Error('Unsupported backup structure.');
  }
  const manifest=JSON.parse(String(db.prepare('SELECT data FROM backup_manifest').get()?.data));
  if(manifest.format!=='gameatlas-full'||manifest.version!==1)throw Error('This backup requires a different GameAtlas version.');
  const row=db.prepare('SELECT data,revision FROM library WHERE id=1').get();if(!row)throw Error('The backup contains no library.');
  if(digest(String(row.data))!==manifest.libraryDigest)throw Error('The library checksum does not match.');
  const library={...JSON.parse(String(row.data)),revision:Number(row.revision)};validate(library);
  const stats=db.prepare('SELECT COUNT(*) AS count, SUM(length(bytes)) AS size, MAX(length(bytes)) AS largest FROM backup_artwork').get()!;
  if(Number(stats.count)>10000||Number(stats.size)>1_000_000_000||Number(stats.largest)>10_000_000)throw Error('Artwork exceeds backup limits.');
  const archivedArtwork=db.prepare('SELECT * FROM backup_artwork').all().map(row=>{
   const key=String(row.key),mime=String(row.mime),bytes=row.bytes;
   if(!/^[a-f0-9]{64}$/.test(key)||!types.has(mime)||!(bytes instanceof Uint8Array)||digest(bytes)!==row.digest)throw Error('A thumbnail in this backup is damaged.');
   return {key,mime,bytes};
  });
  const referenced=referencedArtwork(library),artwork=archivedArtwork.filter(image=>referenced.has(image.key));
  const keys=new Set(artwork.map(a=>a.key));
  const missing=[...new Set([...library.games.map(g=>g.lookup?.coverUrl),...(library.hardware??[]).map(item=>item.coverUrl)].filter((u):u is string=>!!u))].filter(u=>!keys.has(imageKey(u)));
  return {library,artwork,summary:{games:library.games.length,hardware:(library.hardware??[]).length,images:artwork.length,missing,createdAt:String(manifest.createdAt),legacy:false}};
 }finally{db.close();}
}
