import {BrowserWindow} from 'electron';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {preferredSourceUrl,type Game,type Library} from '../lib/library';

const escape=(value:unknown)=>String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const text=(game:Game,key:string)=>Array.isArray(game.values[key])?(game.values[key] as string[]).join(', '):String(game.values[key]??'').trim();
const brandIcon=()=>{
 const path=join(__dirname,'../public/icon-512.png');
 return existsSync(path)?`data:image/png;base64,${readFileSync(path).toString('base64')}`:'';
};
const art=(game:Game,directory:string)=>{
 const url=game.lookup?.coverUrl;if(!url)return '';
 const key=createHash('sha256').update(url).digest('hex'),path=join(directory,'artwork',key),type=path+'.type';
 if(!existsSync(path)||!existsSync(type))return '';
 const mime=readFileSync(type,'utf8');if(!/^image\/(?:png|jpeg|webp|gif|avif)$/.test(mime))return '';
 return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
};
const line=(label:string,value:string)=>value?`<div><b>${escape(label)}</b><span>${escape(value)}</span></div>`:'';
export type PdfScope='all'|'physical';
export function selectPdfLibrary(library:Library,scope:PdfScope):Library{
 if(scope==='all')return library;
 return {...library,games:library.games.filter(game=>{
  const ownership=game.values.Ownership;
  return Array.isArray(ownership)?ownership.includes('Physical'):String(ownership??'')==='Physical';
 })};
}
export function collectionPdfHtml(library:Library,directory:string,created=new Date(),subtitle='Entire Library Catalog'){
 const games=[...library.games].sort((a,b)=>text(a,'Title').localeCompare(text(b,'Title'),undefined,{sensitivity:'base'}));
 const brand=brandIcon();
 const owned=games.filter(g=>/Physical|Digital/.test(text(g,'Ownership'))).length;
 const scored=games.filter(g=>text(g,'Score')!=='').length;
 const cards=games.map((game,index)=>{
  const image=art(game,directory),preferred=preferredSourceUrl(game.lookup?.sources),url=/^https?:\/\//.test(preferred)?preferred:'';
  return `<article class="game"><div class="number">${index+1}</div>${image?`<img src="${image}" alt="">`:'<div class="cover">GA</div>'}<section><h2>${escape(text(game,'Title')||'Untitled game')}</h2><p class="sub">${escape(text(game,'Studio')||'Studio not listed')}${text(game,'Release Date')?' - '+escape(text(game,'Release Date')):''}</p><div class="facts">${line('Platform',text(game,'Platform'))}${line('Ownership',text(game,'Ownership'))}${line('Score',text(game,'Score')?text(game,'Score')+' / 10':'')}${line('ESRB',text(game,'ESRB'))}${line('Status',text(game,'Status'))}${line('Genre',text(game,'Genre'))}${line('Tags',text(game,'Tags'))}</div>${text(game,'Notes')?`<p class="notes"><b>Notes:</b> ${escape(text(game,'Notes'))}</p>`:''}${url?`<a href="${escape(url)}">Game website</a>`:''}</section></article>`;
 }).join('');
 return `<!doctype html><html><head><meta charset="utf-8"><title>GameAtlas Collection</title><style>
  @page{size:letter;margin:.48in .46in .58in}*{box-sizing:border-box}body{margin:0;color:#202820;font-family:"Segoe UI",Arial,sans-serif;font-size:8.6pt;background:#fff}.cover-page{height:9.6in;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;page-break-after:always}.mark{width:88px;height:88px;border-radius:20px;background:#171e27;color:#c7f464;display:grid;place-items:center;font-size:31px;font-weight:800;letter-spacing:-3px}.cover-page h1{font-size:42pt;letter-spacing:-2px;margin:22px 0 4px}.cover-page h1 em{font-style:normal;color:#42651c}.cover-page>p{font-size:14pt;color:#647064;margin:0}.summary{display:flex;gap:12px;margin-top:36px}.summary div{min-width:115px;border:1px solid #ccd5c7;border-radius:12px;padding:14px}.summary b{display:block;font-size:22pt;color:#42651c}.summary span{font-size:8pt;text-transform:uppercase;letter-spacing:1px}.date{margin-top:36px!important;font-size:9pt!important}.catalog{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 12px}.game{position:relative;display:grid;grid-template-columns:54px minmax(0,1fr);gap:9px;min-height:112px;border:1px solid #d6ddd1;border-radius:9px;padding:9px;break-inside:avoid;page-break-inside:avoid;background:#fff}.game img,.cover{width:54px;height:76px;object-fit:contain;border-radius:5px;background:#edf1ea}.cover{display:grid;place-items:center;color:#42651c;font-weight:800;font-size:15pt}.number{position:absolute;right:7px;top:6px;color:#9aa49a;font-size:7pt}.game section{min-width:0}.game h2{font-size:11pt;line-height:1.14;margin:0 18px 2px 0;overflow-wrap:anywhere}.sub{color:#657064;margin:0 0 5px;font-size:7.6pt;overflow-wrap:anywhere}.facts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2px 8px}.facts div{display:flex;gap:4px;min-width:0}.facts b{color:#42651c;white-space:nowrap;font-size:7.2pt}.facts span{min-width:0;overflow-wrap:anywhere;word-break:break-word;font-size:7.2pt}.notes{font-size:7.2pt;line-height:1.25;margin:5px 0 0;color:#515b51;overflow-wrap:anywhere}.game a{display:inline-block;margin-top:4px;color:#365f16;text-decoration:none;font-size:7.2pt}.catalog-title{grid-column:1/-1;border-bottom:2px solid #c7f464;padding:0 0 7px;margin:0 0 2px;font-size:15pt}@media print{a{color:#365f16!important}}
 </style></head><body><section class="cover-page">${brand?`<img class="mark" src="${brand}" alt="GameAtlas icon">`:''}<h1>Game<em>Atlas</em></h1><p>${escape(subtitle)}</p><div class="summary"><div><b>${games.length}</b><span>Total games</span></div><div><b>${owned}</b><span>Owned games</span></div><div><b>${scored}</b><span>Scored games</span></div></div><p class="date">Exported ${escape(created.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}))}</p></section><main class="catalog"><h1 class="catalog-title">Your games</h1>${cards}</main></body></html>`;
}

export async function exportCollectionPdf(library:Library,directory:string,destination:string,subtitle='Entire Library Catalog'){
 const temp=join(directory,'pdf-export-'+randomUUID()+'.html');let pdfWindow:BrowserWindow|undefined;
 try{
  writeFileSync(temp,collectionPdfHtml(library,directory,new Date(),subtitle));
  pdfWindow=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await pdfWindow.loadFile(temp);
  await pdfWindow.webContents.executeJavaScript("Promise.all([...document.images].map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=img.onerror=r})))");
  const bytes=await pdfWindow.webContents.printToPDF({printBackground:true,pageSize:'Letter',displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font:8px Segoe UI,Arial;color:#6b746b;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',margins:{top:0.48,bottom:0.58,left:0.46,right:0.46}});
  writeFileSync(destination,bytes);return {games:library.games.length,bytes:bytes.length};
 }finally{pdfWindow?.destroy();rmSync(temp,{force:true});}
}
