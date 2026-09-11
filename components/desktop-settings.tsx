import {useEffect,useState} from 'react';
import {FolderOpen,Download,Upload,Gamepad2} from 'lucide-react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {Preferences} from '@/desktop/preferences';
export function DesktopSettings({open,onOpenChange,onReload}:{open:boolean;onOpenChange:(v:boolean)=>void;onReload:()=>Promise<void>}){
 const [preferences,setPreferences]=useState<Preferences|null>(null);
 const [step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{void window.gameAtlas.getSettings().then(setPreferences).catch(e=>setError(String(e)));},[open]);
 const wizard=preferences!==null&&!preferences.setupComplete;
 async function start(){
  setBusy(true);setError('');try{if(await window.gameAtlas.startLibrary()){await onReload();setStep(1);}}catch(e){setError(String(e));}finally{setBusy(false);}
 }
 async function choose(){try{const path=await window.gameAtlas.chooseBackupFolder();if(path)setPreferences(p=>p?{...p,backupFolder:path}:p);}catch(e){setError(String(e));}}
 async function importLibrary(){
  setBusy(true);setError('');
  try{if(await window.gameAtlas.restoreBackup()){await onReload();if(wizard)setStep(1);else window.location.reload();}}
  catch(e){setError(String(e));}finally{setBusy(false);}
 }
 async function save(){
  if(!preferences)return;setBusy(true);setError('');
  try{const result=await window.gameAtlas.saveSettings({backupFolder:preferences.backupFolder,backupMode:preferences.backupMode},wizard);
   setPreferences(result);if(result.backupError){setError(result.backupError);onOpenChange(true);return;}setMessage('Settings saved');onOpenChange(false);
  }catch(e){setError(String(e));}finally{setBusy(false);}
 }
 async function backup(){
  setBusy(true);setError('');setMessage('Preparing the complete backup…');
  try{setMessage(await window.gameAtlas.exportBackup());}catch(e){setError(String(e));}finally{setBusy(false);}
 }
 return <Dialog open={open||wizard||(!preferences&&!!error)} onOpenChange={v=>{if(!wizard&&!busy)onOpenChange(v);}}>
  <DialogContent showCloseButton={!wizard} className={wizard?'editor settings-editor setup-wizard':'editor settings-editor'}>
   <DialogTitle>{wizard?'Welcome to GameAtlas':'Settings'}</DialogTitle>
   <DialogDescription>{wizard?(step===0?'Start your own collection or bring an existing library.':'Choose how to protect your collection. You can change this in Settings later.'):'Manage local backups and restore your library.'}</DialogDescription>
   {wizard&&step===0?<div className="setup-choices">
    <button className="setup-choice" disabled={busy} onClick={()=>void start()}><Gamepad2/><strong>Start a new library</strong><span>Begin with an empty game collection.</span></button>
    <button className="setup-choice" disabled={busy} onClick={()=>void importLibrary()}><Upload/><strong>Import a GameAtlas library</strong><span>Choose a complete backup or an older JSON export.</span></button>
   </div>:preferences&&<>
    <div className="settings-section">
     <h2>Local backups</h2>
     <label htmlFor="backup-folder">Backup folder</label>
     <div className="backup-folder-row"><input id="backup-folder" readOnly value={preferences.backupFolder}/><button className="quiet" disabled={busy} onClick={()=>void choose()}><FolderOpen size={18}/> Choose folder</button></div>
     <label htmlFor="backup-schedule">When should backups run?</label>
     <select id="backup-schedule" value={preferences.backupMode} disabled={busy} onChange={e=>setPreferences({...preferences,backupMode:e.target.value as Preferences['backupMode']})}>
      <option value="changes">Whenever a game is added or modified</option>
      <option value="daily">Once a day</option>
      <option value="manual">Manual only</option>
     </select>
     <p className="muted">{preferences.backupMode==='daily'?'Runs once per day while GameAtlas is open. If it is closed, the backup runs the next time you open it.':preferences.backupMode==='changes'?'Creates a complete backup after each library change, including deleting a game.':'Only runs when you choose Save complete backup. A safety copy is still made before restoring a library.'}</p>
     <p className="muted">Backups include the collection and cached thumbnails. Manual backups also try to download missing artwork. A Google Drive folder can sync your backups to another device.</p>
     {preferences.lastBackupAt&&<p className="muted">Last scheduled backup: {new Date(preferences.lastBackupAt).toLocaleString()}</p>}
     {preferences.backupError&&<p role="alert" className="error">{preferences.backupError}</p>}
    </div>
    {!wizard&&<div className="backup-buttons">
     <button className="quiet" disabled={busy} onClick={()=>void backup()}><Download size={18}/> Save complete backup</button>
     <button className="quiet" disabled={busy} onClick={()=>void importLibrary()}><Upload size={18}/> Restore backup</button>
     <button className="quiet" disabled={busy} onClick={()=>{void window.gameAtlas.openBackups().then(e=>{if(e)setError(e);}).catch(e=>setError(String(e)));}}>Open backup folder</button>
    </div>}
    <div className="editor-actions">
     {wizard&&<button className="quiet" disabled={busy} onClick={()=>setStep(0)}>Back</button>}
     <button className="primary" disabled={busy} onClick={()=>void save()}>{busy?'Please wait…':wizard?'Finish setup':'Save settings'}</button>
    </div>
   </>}
   {message&&<p role="status">{message}</p>}
   {error&&<p role="alert" className="error">{error}</p>}
  </DialogContent>
 </Dialog>;
}
