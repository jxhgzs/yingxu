import {app,BrowserWindow,Menu,dialog,shell,ipcMain} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {startServer} from '../../dist-desktop/service/server.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
app.setName('映序剪辑');
let service,window,closing=false;
const preparing=new Map();
function prepareClose(win){
  if(win.isDestroyed())return Promise.resolve(true);
  if(preparing.has(win.id))return preparing.get(win.id);
  const promise=new Promise(resolve=>{
    const requestId=randomUUID();let finished=false;
    const finish=async error=>{
      if(finished)return;finished=true;clearTimeout(timer);ipcMain.removeListener('editor:flushed',listener);
      if(error&&!win.isDestroyed()){
        const choice=await dialog.showMessageBox(win,{type:'warning',buttons:['返回编辑','仍然退出'],defaultId:0,cancelId:0,message:'部分修改尚未保存',detail:error});
        resolve(choice.response===1);
      }else resolve(true);
    };
    const listener=(event,id,error)=>{if(event.sender.id===win.webContents.id&&id===requestId)void finish(error);};
    const timer=setTimeout(()=>{void finish(win.webContents.getURL().startsWith(service.origin)?'编辑器尚未确认保存完成，请返回编辑后重试。':null);},4000);
    ipcMain.on('editor:flushed',listener);win.webContents.send('editor:prepare-close',requestId);
  }).finally(()=>preparing.delete(win.id));
  preparing.set(win.id,promise);return promise;
}
async function createWindow(){
  window=new BrowserWindow({width:1500,height:920,minWidth:1000,minHeight:680,title:'映序剪辑',backgroundColor:'#111113',
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(root,'apps/desktop/preload.cjs')}});
  const current=window;
  current.on('close',event=>{
    if(closing)return;event.preventDefault();
    void prepareClose(current).then(ok=>{if(ok&&!current.isDestroyed())current.destroy();});
  });
  window.webContents.setWindowOpenHandler(({url})=>{
    if(new URL(url).origin===service.origin){const child=new BrowserWindow({parent:window,width:1000,height:700,backgroundColor:'#111113',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});void child.loadURL(url);}
    return {action:'deny'};
  });
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==service.origin)event.preventDefault();});
  await window.loadURL(service.origin);
}
void app.whenReady().then(async()=>{
try{
  // Desktop and browser development deliberately use separate application data.
  service=await startServer({root:process.env.YINGXU_EDITOR_DATA||path.join(app.getPath('userData'),'editor-data'),port:0,dist:path.join(root,'dist')});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'映序剪辑',submenu:[{label:'关于映序剪辑',role:'about'},{type:'separator'},{label:'退出映序剪辑',role:'quit'}]},
    {label:'文件',submenu:[{label:'新建窗口',accelerator:'CmdOrCtrl+N',click:()=>void createWindow()},{label:'打开数据目录',click:()=>void shell.openPath(service.store.root)}]},
    {label:'编辑',submenu:[{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
    {label:'视图',submenu:[{role:'reload',label:'重新载入'},{role:'toggleDevTools',label:'开发者工具'},{role:'togglefullscreen',label:'全屏'}]}
  ]));
  await createWindow();
  app.on('activate',()=>{if(!closing&&BrowserWindow.getAllWindows().length===0)void createWindow();});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
  app.on('before-quit',event=>{
    event.preventDefault();if(closing)return;closing=true;
    void (async()=>{
      const windows=BrowserWindow.getAllWindows(),ready=await Promise.all(windows.map(prepareClose));
      if(ready.some(ok=>!ok)){closing=false;return;}
      for(const win of windows)if(!win.isDestroyed())win.destroy();
      await service.close();app.exit(0);
    })().catch(error=>{dialog.showErrorBox('退出前保存失败',String(error));closing=false;});
  });
}catch(error){dialog.showErrorBox('编辑器启动失败',String(error));app.quit();}
});
