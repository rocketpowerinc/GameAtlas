const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gameAtlas', {
 getUpdateStatus: () => ipcRenderer.invoke('update-status'),
 checkUpdates: () => ipcRenderer.invoke('check-updates'),
 onUpdateStatus: (callback) => {const listener=(_event,status)=>callback(status);ipcRenderer.on('update-status',listener);return ()=>ipcRenderer.removeListener('update-status',listener);},
 startLibrary: () => ipcRenderer.invoke('start-library'),
 getSettings: () => ipcRenderer.invoke('get-settings'),
 saveSettings: (input,complete) => ipcRenderer.invoke('save-settings',input,complete),
 request: (path,method,body) => ipcRenderer.invoke('request',path,method,body),
 restoreBackup: () => ipcRenderer.invoke('restore-backup'),
 exportBackup: () => ipcRenderer.invoke('export-backup'),
 chooseBackupFolder: () => ipcRenderer.invoke('backup-folder'),
 openBackups: () => ipcRenderer.invoke('open-backups')
});
