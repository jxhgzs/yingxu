import {app,BrowserWindow,Menu,dialog,shell} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../../dist-desktop/service/server.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
app.setName('映序剪辑');
let service,window,closing=false,stopped=false;
async function createWindow(){
  window=new BrowserWindow({width:1500,height:920,minWidth:1000,minHeight:680,title:'映序剪辑',backgroundColor:'#111113',
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
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
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)void createWindow();});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
  app.on('before-quit',event=>{
    if(stopped)return;event.preventDefault();if(closing)return;closing=true;
    void service.close().finally(()=>{stopped=true;app.quit();});
  });
}catch(error){dialog.showErrorBox('编辑器启动失败',String(error));app.quit();}
});
