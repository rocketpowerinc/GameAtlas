import {createHash,randomUUID} from 'node:crypto';
import {createWriteStream,existsSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
export const repository='https://api.github.com/repos/rocketpowerinc/GameAtlas';
export type UpdateRelease={version:string;url:string;size:number;digest:string;notes?:string};
function versionParts(raw:string){const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(raw);if(!m)throw Error('Unsupported release version.');const parts=m.slice(1).map(Number);if(parts.some(n=>!Number.isSafeInteger(n)))throw Error('Invalid release version.');return parts;}
export function newer(candidate:string,current:string){const a=versionParts(candidate),b=versionParts(current);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
export function selectRelease(raw:any,current:string):UpdateRelease|null{
 if(!raw||raw.draft||raw.prerelease)return null;
 const version=String(raw.tag_name).replace(/^v/,'');if(!newer(version,current))return null;
 const filename=new RegExp('^GameAtlas[ .]Setup[ .]'+version.replaceAll('.','\\.')+'\\.exe$','i');
 const asset=Array.isArray(raw.assets)?raw.assets.find((a:any)=>filename.test(a.name)&&a.state==='uploaded'):null;
 if(!asset||!Number.isSafeInteger(asset.id)||asset.id<=0||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>400_000_000||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('The new release does not have a verified Windows installer yet. Try again later.');
 return {version,notes:typeof raw.body==='string'?raw.body.trim().slice(0,50000):'',url:repository+'/releases/assets/'+asset.id,size:asset.size,digest:asset.digest.slice(7)};
}
const headers=(accept:string)=>({'User-Agent':'GameAtlas-Windows-Updater',Accept:accept,'X-GitHub-Api-Version':'2022-11-28'});
export async function latest(current:string,request:typeof fetch=fetch){
 const response=await request(repository+'/releases/latest',{headers:headers('application/vnd.github+json'),redirect:'error',signal:AbortSignal.timeout(20000)});
 if([401,403,404].includes(response.status))throw new Error('GitHub could not provide the release. Access may be rate-limited; try again later.');
 if(!response.ok)throw Error('GitHub is temporarily unavailable. Try again later.');
 const text=await response.text();if(text.length>2_000_000)throw Error('Release information is too large.');
 return selectRelease(JSON.parse(text),current);
}
export async function download(release:UpdateRelease,directory:string,progress:(n:number)=>void=()=>{},request:typeof fetch=fetch){
 if(!new RegExp('^'+repository+'/releases/assets/[0-9]+$').test(release.url))throw Error('Invalid release download.');
 mkdirSync(directory,{recursive:true});
 const partial=join(directory,randomUUID()+'.partial'),destination=join(directory,'GameAtlas-'+release.version+'-'+randomUUID()+'.exe');
 try{
  let url=release.url,response:Response|undefined;
  for(let i=0;i<5;i++){
   response=await request(url,{headers:headers('application/octet-stream'),redirect:'manual',signal:AbortSignal.timeout(180000)});
   if([301,302,303,307,308].includes(response.status)){
    const next=new URL(response.headers.get('location')||'',url);
    if(next.protocol!=='https:'||next.username||next.password||next.port&&next.port!=='443'||!['release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname))throw Error('GitHub returned an unexpected download destination.');
    url=next.href;continue;
   }
   break;
  }
  if(!response?.ok||!response.body)throw Error('The installer could not be downloaded. Try again.');
  const hash=createHash('sha256');let size=0,last=-1;
  const verify=new Transform({transform(chunk,encoding,callback){
   size+=chunk.length;if(size>release.size){callback(Error('The downloaded installer is larger than expected.'));return;}
   hash.update(chunk);const percent=Math.floor(size/release.size*100);if(percent!==last){last=percent;progress(percent);}callback(null,chunk);
  }});
  await pipeline(Readable.fromWeb(response.body as any),verify,createWriteStream(partial,{flags:'wx'}));
  if(size!==release.size||hash.digest('hex')!==release.digest)throw Error('The installer failed its integrity check. It has been discarded.');
  renameSync(partial,destination);return destination;
 }catch(e){if(existsSync(partial))rmSync(partial,{force:true});throw e;}
}
