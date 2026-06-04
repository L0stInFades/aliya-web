const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('aliyaDesktop', {
  isDesktop: true,
  getDiagnostics: () => ipcRenderer.invoke('aliya:get-diagnostics'),
  openDiagnosticsFolder: () => ipcRenderer.invoke('aliya:open-diagnostics-folder'),
  checkForUpdates: () => ipcRenderer.invoke('aliya:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('aliya:install-update'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') {
      return () => {}
    }
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('aliya:update-status', listener)
    return () => ipcRenderer.removeListener('aliya:update-status', listener)
  }
})
