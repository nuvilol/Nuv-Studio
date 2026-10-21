const { contextBridge, ipcRenderer } = require('electron');
const call = n => (...a) => ipcRenderer.invoke(n, ...a);
const send = n => (...a) => ipcRenderer.send(n, ...a);
const on = n => cb => { ipcRenderer.on(n, (_, ...a) => cb(...a)); };
contextBridge.exposeInMainWorld('native', {
  pickFolder: call('pickFolder'), readDir: call('readDir'), readFile: call('readFile'), writeFile: call('writeFile'),
  collectRepo: call('collectRepo'), listFiles: call('listFiles'), createFile: call('createFile'), createDir: call('createDir'),
  rename: call('rename'), remove: call('remove'), reveal: call('reveal'), overlay: call('overlay'),
  openExternal: call('openExternal'),
  // integrated terminal
  termCreate: call('termCreate'), termWrite: send('termWrite'), termResize: send('termResize'), termKill: send('termKill'),
  onTermData: on('termData'), onTermExit: on('termExit'),
});