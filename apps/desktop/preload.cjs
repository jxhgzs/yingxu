const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('yingxuDesktop',{
  onPrepareClose(handler){
    const listener=async(_event,id)=>{
      try{await handler();ipcRenderer.send('editor:flushed',id,null);}
      catch(error){ipcRenderer.send('editor:flushed',id,String(error).slice(0,500));}
    };
    ipcRenderer.on('editor:prepare-close',listener);
    return ()=>ipcRenderer.removeListener('editor:prepare-close',listener);
  }
});
