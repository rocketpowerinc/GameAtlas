import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {collectionPdfHtml,selectPdfLibrary}=require('../desktop-dist/pdf-export.cjs');
const dir=mkdtempSync(join(tmpdir(),'gameatlas-pdf-test-'));
try{
 const library={revision:1,fields:[],hardware:[
  {id:'console-old',name:'Nintendo Test System',type:'Console',manufacturer:'Nintendo',model:'Launch model',releaseDate:'2017-01-01',notes:'Boxed'},
  {id:'console-new',name:'Nintendo Test System 2',type:'Console',manufacturer:'Nintendo',releaseDate:'2021-01-01'},
  {id:'controller',name:'Test controller',type:'Controller',manufacturer:'Nintendo',releaseDate:'2018-01-01'},
  {id:'mobile',name:'Test mobile controller',type:'Mobile',manufacturer:'Test maker',releaseDate:'2018-06-01'},
  {id:'peripheral',name:'Test accessory',type:'Peripheral',manufacturer:'Nintendo',quantity:4,releaseDate:'2019-01-01'},
  {id:'emulation',name:'Test emulation system',type:'Emulation Console',manufacturer:'Test maker',releaseDate:'2020-01-01'},
  {id:'vr',name:'Test VR headset',type:'VR',manufacturer:'Test maker',releaseDate:'2022-01-01'},
  {id:'book',name:'Test book',type:'Book',manufacturer:'Test author',releaseDate:'2023-01-01'},
  {id:'headphones',name:'Test headphones',type:'Headphones',manufacturer:'Test maker',releaseDate:'2023-06-01'},
  {id:'misc',name:'Test collectible',type:'Misc',manufacturer:'Test maker',releaseDate:'2024-01-01'}
 ],games:[
  {id:'2',values:{Title:'Zelda & Friends',Platform:['Switch'],Ownership:['Physical'],Score:9,ESRB:'E10+ — Everyone 10+',Status:['Must Play'],'Play Next On':['Steam','Switch 2'],Genre:['Adventure'],Studio:'Nintendo',Notes:'Keep <safe>','Release Date':'2021-11-12'},lookup:{sources:[{name:'Wikipedia',url:'https://en.wikipedia.org/wiki/Zelda'}]}},
  {id:'1',values:{Title:'Alpha',Ownership:['Digital'],Studio:'Studio','Release Date':'2017-03-03'}}
 ]};
 const html=collectionPdfHtml(library,dir,new Date('2026-09-15T12:00:00Z'),'Entire Library Catalog');
 assert(html.includes('Entire Library Catalog'));
 assert(html.includes('alt="GameAtlas icon"'));
 assert(html.includes('data:image/png;base64,'));
 assert(html.includes('<b>2</b><span>Consoles</span>'));
 assert(html.includes('<b>1</b><span>Total Physical Games Owned</span>'));
 assert(!html.includes('<span>Peripherals</span>'));
 assert(html.indexOf('<span>Consoles</span>')<html.indexOf('<span>Total Physical Games Owned</span>'));
 assert(!html.includes('<span>Total games</span>')&&!html.includes('<span>Owned games</span>')&&!html.includes('<span>Scored games</span>'));
 assert(html.indexOf('Nintendo Test System')<html.indexOf('Your games'));
 assert(html.indexOf('2017')<html.indexOf('2021'));
 const peripheralSection=html.slice(html.indexOf('peripheral-catalog'),html.indexOf('book-catalog'));
 const gameSection=html.slice(html.indexOf('class="catalog games-catalog"'));
 assert(peripheralSection.includes('<div class="number">1</div>')&&!peripheralSection.includes('<div class="number">2</div>'));
 assert(peripheralSection.includes('<b>Quantity</b><span>4</span>'));
 for(const title of ['Controllers','Mobile','Peripherals','Emulation Consoles','VR','Books','Headphones','Misc'])assert(html.includes(`<h1 class="catalog-title">${title}</h1>`));
 assert(html.indexOf('Consoles</h1>')<html.indexOf('Emulation Consoles</h1>')&&html.indexOf('Emulation Consoles</h1>')<html.indexOf('VR</h1>')&&html.indexOf('VR</h1>')<html.indexOf('Controllers</h1>')&&html.indexOf('Controllers</h1>')<html.indexOf('Mobile</h1>')&&html.indexOf('Mobile</h1>')<html.indexOf('Peripherals</h1>')&&html.indexOf('Peripherals</h1>')<html.indexOf('Books</h1>')&&html.indexOf('Books</h1>')<html.indexOf('Headphones</h1>')&&html.indexOf('Headphones</h1>')<html.indexOf('Misc</h1>')&&html.indexOf('Misc</h1>')<html.indexOf('Your games</h1>'));
 assert(html.includes('.hardware-catalog~.hardware-catalog,.games-catalog{break-before:page;page-break-before:always}'));
 assert(gameSection.indexOf('2017')<gameSection.indexOf('2021'));
 assert(html.indexOf('<h2>Alpha</h2>')<html.indexOf('<h2>Zelda &amp; Friends</h2>'));
 assert(html.includes('Keep &lt;safe&gt;')&&!html.includes('Keep <safe>'));
 assert(html.includes('href="https://en.wikipedia.org/wiki/Zelda"'));
 assert(html.includes('E10+ - Everyone 10+'));
 assert(html.includes('<b>Replay on</b><span>Steam, Switch 2</span>'));
 assert.equal(selectPdfLibrary(library,'all').games.length,2);
 assert.equal(selectPdfLibrary(library,'physical').games.length,1);
 assert.equal(selectPdfLibrary(library,'physical').games[0].values.Title,'Zelda & Friends');
 assert.equal(selectPdfLibrary(library,'physical').hardware.length,10);
 console.log('PASS: PDF cover totals, chronological category/game groups, independent category numbering, section page separation, safe text and clickable links.');
}finally{rmSync(dir,{recursive:true,force:true});}
