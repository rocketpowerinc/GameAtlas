const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gameAtlas', {
 request: (path,method,body) => ipcRenderer.invoke('request',path,method,body),
 restoreBackup: () => ipcRenderer.invoke('restore-backup'),
 exportBackup: () => ipcRenderer.invoke('export-backup'),
 chooseBackupFolder: () => ipcRenderer.invoke('backup-folder'),
 openBackups: () => ipcRenderer.invoke('open-backups')
});
