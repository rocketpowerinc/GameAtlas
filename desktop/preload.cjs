const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gameAtlas', {
 getArtworkStatus:()=>ipcRenderer.invoke('artwork-status'),
 scanArtwork:()=>ipcRenderer.invoke('scan-artwork'),
 cancelArtworkScan:()=>ipcRenderer.invoke('cancel-artwork-scan'),
 applyArtwork:(id,url)=>ipcRenderer.invoke('apply-artwork',id,url),
 chooseArtworkFile:id=>ipcRenderer.invoke('choose-artwork-file',id),
 getMissingDescriptions:()=>ipcRenderer.invoke('description-status'),
 applyDescription:(id,description)=>ipcRenderer.invoke('apply-description',id,description),
 getUpdateStatus: () => ipcRenderer.invoke('update-status'),
 installUpdate:version=>ipcRenderer.invoke('install-update',version),
 dismissUpdate:()=>ipcRenderer.invoke('dismiss-update'),
 checkUpdates: () => ipcRenderer.invoke('check-updates'),
 onUpdateStatus: (callback) => {const listener=(_event,status)=>callback(status);ipcRenderer.on('update-status',listener);return ()=>ipcRenderer.removeListener('update-status',listener);},
 startLibrary: () => ipcRenderer.invoke('start-library'),
 getSettings: () => ipcRenderer.invoke('get-settings'),
 saveSettings: (input,complete) => ipcRenderer.invoke('save-settings',input,complete),
 request: (path,method,body) => ipcRenderer.invoke('request',path,method,body),
 restoreBackup: () => ipcRenderer.invoke('restore-backup'),
 exportBackup: () => ipcRenderer.invoke('export-backup'),
 exportCollectionPdf: scope => ipcRenderer.invoke('export-collection-pdf',scope),
 chooseBackupFolder: () => ipcRenderer.invoke('backup-folder'),
 openBackups: () => ipcRenderer.invoke('open-backups')
});
