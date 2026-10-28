'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xiaoqi', {
  onState(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  },
  dragStart() {
    ipcRenderer.send('pet:drag-start');
  },
  dragMove() {
    ipcRenderer.send('pet:drag-move');
  },
  dragEnd() {
    ipcRenderer.send('pet:drag-end');
  },
  togglePanel() {
    ipcRenderer.send('pet:toggle-panel');
  },
  closePanel() {
    ipcRenderer.send('panel:close');
  },
  openTask(id) {
    ipcRenderer.send('task:open', id);
  },
});
