// Render the shared vector master at native Windows icon sizes.
const {app,BrowserWindow}=require('electron');
const {readFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
app.whenReady().then(async()=>{
 const root=join(__dirname,'..');
 const svg=readFileSync(join(root,'public/brand-mark.svg'),'utf8');
 const icon=svg.replace('<g fill=', '<rect width="512" height="512" rx="100" fill="#171e27"/><g fill=');
 const window=new BrowserWindow({width:512,height:512,useContentSize:true,show:false,transparent:true,frame:false,webPreferences:{sandbox:true,contextIsolation:true}});
 const frames=[];
 for(const size of [16,24,32,48,64,128,256,512]){
  window.setContentSize(size,size);
  await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style>'+icon));
  await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const image=await window.webContents.capturePage();
  const png=image.resize({width:size,height:size,quality:'best'}).toPNG();
  if(size===512)writeFileSync(join(root,'public/icon-512.png'),png);
  else frames.push({size,png});
 }
 const header=Buffer.alloc(6+16*frames.length);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);
 let offset=header.length;
 frames.forEach(({size,png},i)=>{const p=6+16*i;header[p]=size===256?0:size;header[p+1]=size===256?0:size;header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length;});
 writeFileSync(join(root,'public/icon.ico'),Buffer.concat([header,...frames.map(f=>f.png)]));
 window.destroy();console.log('Generated Atlas Library PNG and 7-size Windows ICO.');app.quit();
}).catch(e=>{console.error(e);app.exit(1);});

