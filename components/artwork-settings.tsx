import {useEffect,useState} from 'react';
import type {ArtworkScanStatus,MissingThumbnail} from '@/desktop/artwork-scan';
import type {LookupCandidate} from '@/lib/game-lookup';
import {desktopRequest,artworkUrl} from '@/lib/desktop';
export function ArtworkSettings({disabled,onBusy,onReload}:{disabled:boolean;onBusy:(v:boolean)=>void;onReload:()=>Promise<void>}){
 const [status,setStatus]=useState<ArtworkScanStatus|null>(null),[working,setWorking]=useState(false),[error,setError]=useState('');
 const [selected,setSelected]=useState<MissingThumbnail|null>(null),[query,setQuery]=useState(''),[candidates,setCandidates]=useState<LookupCandidate[]>([]);
 const [preview,setPreview]=useState<{url:string;name:string}|null>(null),[imageFailed,setImageFailed]=useState(false);
 useEffect(()=>{let active=true;const refresh=()=>window.gameAtlas.getArtworkStatus().then(s=>{if(active)setStatus(s);}).catch(e=>{if(active)setError(String(e));});void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{active=false;clearInterval(timer);};},[]);
 const busy=working||!!status?.running;
 async function perform(action:()=>Promise<void>){setWorking(true);onBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);onBusy(false);}}
 async function finish(){setStatus(await window.gameAtlas.getArtworkStatus());await onReload();window.dispatchEvent(new Event('artwork-updated'));setSelected(null);setPreview(null);setCandidates([]);}
 return <div className="settings-section artwork-settings">
  <h2>Missing thumbnails</h2>
  <p className="muted">Find and download artwork for games with missing thumbnails. Only artwork changes; your titles, scores, descriptions, and other properties stay as they are.</p>
  <div className="backup-buttons">
   <button className="quiet" disabled={disabled||busy||!status||status.missing.length===0} onClick={()=>void perform(async()=>{setSelected(null);setStatus(await window.gameAtlas.scanArtwork());await onReload();})}>Scrape all missing thumbnails</button>
   {status?.running&&<button className="quiet" onClick={()=>void window.gameAtlas.cancelArtworkScan().catch(e=>setError(String(e)))}>Stop after current request</button>}
  </div>
  {status&&<p role="status" className="muted">{status.running?'Checking '+status.processed+' of '+status.total+' — '+status.current:status.total? (status.cancelled?'Stopped. ':'')+status.added+' thumbnails downloaded. '+status.missing.length+' still missing.':status.missing.length+' games have missing thumbnails.'}</p>}
  {status?.running&&<progress aria-label="Thumbnail scan progress" value={status.processed} max={status.total||1}/>}
  {status?.error&&<p role="alert" className="error">{status.error}</p>}
  {!busy&&!!status?.missing.length&&<details className="artwork-review"><summary>Review missing thumbnails ({status.missing.length})</summary>
   <div className="artwork-missing-list">{status.missing.map(game=><button className="quiet artwork-missing-game" key={game.id} disabled={disabled} onClick={()=>{setSelected(game);setQuery(game.title);setCandidates([]);setPreview(null);setError('');}}><strong>{game.title}</strong><span>{game.platform}</span><small>{game.reason}</small></button>)}</div>
  </details>}
  {selected&&<div className="artwork-choice">
   <h3>Choose artwork for {selected.title}</h3>
   <label htmlFor="artwork-query">Game title or IGN, Steam, or Wikipedia link</label>
   <input maxLength={500} id="artwork-query" value={query} onChange={e=>setQuery(e.target.value)} disabled={disabled||busy}/>
   <div className="backup-buttons">
    <button className="quiet" disabled={disabled||busy||query.trim().length<2} onClick={()=>void perform(async()=>{setPreview(null);const r=await desktopRequest('/api/game-lookup',{method:'POST',body:JSON.stringify({action:'search',query})});const data=await r.json();if(!r.ok)throw Error(data.error);setCandidates(data.candidates);if(!data.candidates.length)setError('No matches found. Try another title or choose an image file.');})}>Search matches</button>
    <button className="quiet" disabled={disabled||busy} onClick={()=>void perform(async()=>{if(await window.gameAtlas.chooseArtworkFile(selected.id))await finish();})}>Choose image file</button>
    <button className="quiet" disabled={disabled||busy} onClick={()=>{setSelected(null);setPreview(null);}}>Leave missing for now</button>
   </div>
   <div className="artwork-candidates">{candidates.map((c,i)=><button className="quiet" key={i} disabled={disabled||busy} onClick={()=>void perform(async()=>{setPreview(null);const r=await desktopRequest('/api/game-lookup',{method:'POST',body:JSON.stringify({action:'details',candidate:c})});const data=await r.json();if(!r.ok)throw Error(data.error);if(!data.coverUrl)throw Error('This match has no artwork. Try another match or choose an image file.');setImageFailed(false);setPreview({url:data.coverUrl,name:c.name});})}><strong>{c.name}</strong><small>{c.description}</small></button>)}</div>
   {preview&&<div className="artwork-preview"><img src={artworkUrl(preview.url)} alt={preview.name} onError={()=>setImageFailed(true)}/><span>{preview.name}</span>{imageFailed?<p className="error">This image could not be downloaded. Try another match or choose an image file.</p>:<button className="primary" disabled={disabled||busy} onClick={()=>void perform(async()=>{await window.gameAtlas.applyArtwork(selected.id,preview.url);await finish();})}>Use this thumbnail</button>}</div>}
  </div>}
  {error&&<p className="error" role="alert">{error}</p>}
 </div>;
}
