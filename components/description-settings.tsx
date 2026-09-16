'use client';
import {useEffect,useState} from 'react';
import {ArrowLeft,FileText} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';

type MissingDescription={id:string;title:string;platform:string};

export function DescriptionSettings({onClose,onReload}:{onClose:()=>void;onReload:()=>Promise<void>}){
 const [games,setGames]=useState<MissingDescription[]>([]),[selected,setSelected]=useState<MissingDescription|null>(null);
 const [description,setDescription]=useState(''),[busy,setBusy]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function refresh(){setBusy(true);setError('');try{setGames(await window.gameAtlas.getMissingDescriptions());}catch(e){setError(String(e));}finally{setBusy(false);}}
 useEffect(()=>{void refresh();},[]);
 async function save(){if(!selected||!description.trim())return;setBusy(true);setError('');setMessage('');try{await window.gameAtlas.applyDescription(selected.id,description);await onReload();setSelected(null);setDescription('');setMessage('Description saved.');await refresh();}catch(e){setError(String(e));setBusy(false);}}
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}>
  <DialogContent className="editor description-settings">
   {selected?<>
    <button className="text-button description-back" onClick={()=>{setSelected(null);setDescription('');setError('');}} disabled={busy}><ArrowLeft size={16}/> Back to missing descriptions</button>
    <DialogTitle>Add a description</DialogTitle>
    <DialogDescription>{selected.title} · {selected.platform}</DialogDescription>
    <label className="field" htmlFor="missing-game-description"><span>Game description</span><textarea id="missing-game-description" rows={9} maxLength={6000} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Write a clear summary of the game, its story, or how it plays." autoFocus/></label>
    <div className="editor-actions"><button className="primary" disabled={busy||!description.trim()} onClick={()=>void save()}>{busy?'Saving…':'Save description'}</button></div>
   </>:<>
    <DialogTitle>Missing descriptions</DialogTitle>
    <DialogDescription>Choose a game below and add its description manually.</DialogDescription>
    {busy?<p className="muted">Checking your library…</p>:games.length?<>
     <p className="muted">{games.length} {games.length===1?'game needs':'games need'} a description.</p>
     <div className="description-missing-list">{games.map(game=><button className="quiet description-missing-game" key={game.id} onClick={()=>{setSelected(game);setMessage('');}}><span><FileText size={17}/><strong>{game.title}</strong></span><small>{game.platform}</small><b>Add description →</b></button>)}</div>
    </>:<div className="description-complete"><FileText size={34}/><strong>Every game has a description.</strong><span className="muted">There is nothing left to review.</span></div>}
   </>}
   {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="error">{error}</p>}
  </DialogContent>
 </Dialog>;
}
