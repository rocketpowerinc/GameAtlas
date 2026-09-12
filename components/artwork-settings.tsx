import {useEffect,useState} from 'react';
import type {ArtworkScanStatus,MissingThumbnail} from '@/desktop/artwork-scan';
import type {LookupCandidate} from '@/lib/game-lookup';
import {desktopRequest} from '@/lib/desktop';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
export function ArtworkSettings({onClose,onReload}:{onClose:()=>void;onReload:()=>Promise<void>}){
 const [status,setStatus]=useState<ArtworkScanStatus|null>(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [selected,setSelected]=useState<MissingThumbnail|null>(null),[query,setQuery]=useState(''),[candidates,setCandidates]=useState<LookupCandidate[]>([]);
 const [preview,setPreview]=useState<{url:string;dataUrl:string}[]>([]),[previewIndex,setPreviewIndex]=useState(0),[loaded,setLoaded]=useState(false),[searched,setSearched]=useState(false);
 useEffect(()=>{let active=true;const refresh=()=>window.gameAtlas.getArtworkStatus().then(s=>{if(active)setStatus(s);}).catch(e=>{if(active)setError(String(e));});void refresh();const timer=setInterval(()=>void refresh(),1500);return()=>{active=false;clearInterval(timer);};},[]);
 const busy=working||!!status?.running;
 async function perform(action:()=>Promise<void>){setWorking(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);}}
 async function finish(){setStatus(await window.gameAtlas.getArtworkStatus());await onReload();window.dispatchEvent(new Event('artwork-updated'));setMessage('Artwork saved for '+selected?.title+'.');setSelected(null);setPreview([]);setCandidates([]);}
 async function search(text:string){setPreview([]);setCandidates([]);setSearched(false);const r=await desktopRequest('/api/game-lookup',{method:'POST',body:JSON.stringify({action:'search',query:text})});const data=await r.json();if(!r.ok)throw Error(data.error);setCandidates(data.candidates);setSearched(true);}
 async function prepare(c:LookupCandidate){setPreview([]);setLoaded(false);const r=await desktopRequest('/api/game-lookup',{method:'POST',body:JSON.stringify({action:'artwork',candidate:c})});const data=await r.json();if(!r.ok)throw Error(data.error);setPreviewIndex(0);setPreview(data.previews);}
 const current=preview[previewIndex];
 return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose();}}>
 <DialogContent showCloseButton={!busy} className="editor artwork-window">
 <DialogTitle>Missing artwork</DialogTitle>
 <DialogDescription>{selected?'Choose a thumbnail for this game.':'Find artwork for your collection, then choose any remaining images yourself.'}</DialogDescription>
 <div className="artwork-settings">
 {!selected?<>
  <div className="artwork-intro"><h2>{status?status.missing.length+' games need artwork':'Checking your library…'}</h2><p className="muted">Your game details and existing thumbnails stay unchanged.</p></div>
  <h3>1. Let GameAtlas find artwork</h3>
  <button className="primary" disabled={busy||!status||status.missing.length===0} onClick={()=>void perform(async()=>{setMessage('');const result=await window.gameAtlas.scanArtwork();setStatus(result);if(result.error)setError(result.error);setMessage((result.cancelled?'Stopped. ':'')+result.added+' thumbnails added.');await onReload();window.dispatchEvent(new Event('artwork-updated'));})}>Find artwork automatically</button>
  {status?.running&&<><p role="status">Checking {status.processed} of {status.total}: {status.current}</p><progress aria-label="Thumbnail scan progress" value={status.processed} max={status.total||1}/><button className="quiet" onClick={()=>void window.gameAtlas.cancelArtworkScan().catch(e=>setError(String(e)))}>Stop search</button></>}
  {!busy&&!!status?.missing.length&&<div className="artwork-review"><h3>2. Choose artwork for the rest</h3><p className="muted">Select a game to search for a match or use a picture on your PC.</p>
   <div className="artwork-missing-list">{status.missing.map(game=><button className="quiet artwork-missing-game" key={game.id} onClick={()=>{setSelected(game);setQuery(game.title);setPreview([]);setCandidates([]);setMessage('');void perform(()=>search(game.title));}}><strong>{game.title}</strong><span>{game.platform}</span><small>Choose artwork →</small></button>)}</div>
  </div>}
  {!busy&&status?.missing.length===0&&<p role="status">All games have downloaded artwork. You’re done!</p>}
 </>:<>
  <button className="quiet" disabled={busy} onClick={()=>{setSelected(null);setPreview([]);setError('');}}>← Back to missing games</button>
  <h2>{selected.title}</h2><p className="muted">{selected.platform}</p>
  <div className="artwork-local"><button className="quiet" disabled={busy} onClick={()=>void perform(async()=>{if(await window.gameAtlas.chooseArtworkFile(selected.id))await finish();})}>Choose image file</button><span className="muted">Use a picture saved on your PC.</span></div>
  <label htmlFor="artwork-query">Search by game title or paste a game page link</label>
  <div className="artwork-search"><input maxLength={500} id="artwork-query" value={query} onChange={e=>setQuery(e.target.value)} disabled={busy} onKeyDown={e=>{if(e.key==='Enter'&&query.trim().length>=2)void perform(()=>search(query));}}/><button className="primary" disabled={busy||query.trim().length<2} onClick={()=>void perform(()=>search(query))}>Search</button></div>
  {working&&<p role="status">Looking up artwork…</p>}
  {!working&&searched&&!candidates.length&&<p>No matches found. Try a shorter title or choose an image file above.</p>}
  <div className="artwork-candidates">{candidates.map((c,i)=><button className="quiet" key={i} disabled={busy} onClick={()=>void perform(()=>prepare(c))}><strong>{c.name}</strong><small>{c.description}</small><span>Preview artwork →</span></button>)}</div>
  {current&&<div className="artwork-preview"><img key={current.url} src={current.dataUrl} alt={'Artwork for '+selected.title} onLoad={()=>setLoaded(true)} onError={()=>{setLoaded(false);setPreviewIndex(i=>i+1);if(previewIndex+1>=preview.length)setError('The source returned an image Windows cannot display. Choose another match or an image file.');}}/><button className="primary" disabled={busy||!loaded} onClick={()=>void perform(async()=>{await window.gameAtlas.applyArtwork(selected.id,current.url);await finish();})}>Use this artwork</button></div>}
 </>}
 {message&&<p role="status" className="artwork-success">{message}</p>}
 {error&&<div role="alert" className="error"><p>{error}</p><p>Try another match, retry the search, or choose an image file from your PC.</p></div>}
 </div>
 <div className="editor-actions"><button className="quiet" disabled={busy} onClick={onClose}>Return to library</button></div>
 </DialogContent></Dialog>;
}
