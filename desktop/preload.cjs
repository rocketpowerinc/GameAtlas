const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gameAtlas', {
 request: (path,method,body) => ipcRenderer.invoke('request',path,method,body),
 exportBackup: () => ipcRenderer.invoke('export-backup'),
 chooseBackupFolder: () => ipcRenderer.invoke('backup-folder'),
 openBackups: () => ipcRenderer.invoke('open-backups')
});

