'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadProfile: () => ipcRenderer.invoke('profile:load'),
  pickKey: () => ipcRenderer.invoke('key:pick'),
  connect: (p) => ipcRenderer.invoke('ssh:connect', p),
  disconnect: () => ipcRenderer.invoke('ssh:disconnect'),
  run: (req) => ipcRenderer.invoke('run', req),
  checkUrl: (u) => ipcRenderer.invoke('check:url', u),
  copy: (t) => ipcRenderer.invoke('clipboard:write', t),
  loadApps: () => ipcRenderer.invoke('apps:load'),
  saveApps: (a) => ipcRenderer.invoke('apps:save', a),
  updateInfo: () => ipcRenderer.invoke('update:info'),
  updateSetMode: (m) => ipcRenderer.invoke('update:setMode', m),
  updateSetRepo: (r) => ipcRenderer.invoke('update:setRepo', r),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (fn) => ipcRenderer.on('update:progress', (_e, m) => fn(m)),
  onData: (fn) => ipcRenderer.on('run:data', (_e, m) => fn(m)),
  onClosed: (fn) => ipcRenderer.on('ssh:closed', () => fn()),
});
