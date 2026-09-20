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
  {id:'peripheral',name:'Test controller',type:'Peripheral',manufacturer:'Nintendo',releaseDate:'2019-01-01'}
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
 assert(html.includes('<b>1</b><span>Peripherals</span>'));
 assert(html.indexOf('<span>Consoles</span>')<html.indexOf('<span>Total Physical Games Owned</span>')&&html.indexOf('<span>Total Physical Games Owned</span>')<html.indexOf('<span>Peripherals</span>'));
 assert(!html.includes('<span>Total games</span>')&&!html.includes('<span>Owned games</span>')&&!html.includes('<span>Scored games</span>'));
 assert(html.indexOf('Nintendo Test System')<html.indexOf('Your games'));
 assert(html.indexOf('2017')<html.indexOf('2021'));
 const peripheralSection=html.slice(html.indexOf('class="catalog peripherals-catalog"'),html.indexOf('class="catalog games-catalog"'));
 const gameSection=html.slice(html.indexOf('class="catalog games-catalog"'));
 assert(peripheralSection.includes('<div class="number">1</div>')&&!peripheralSection.includes('<div class="number">2</div>'));
 assert(html.includes('.peripherals-catalog,.games-catalog{break-before:page;page-break-before:always}'));
 assert(gameSection.indexOf('2017')<gameSection.indexOf('2021'));
 assert(html.indexOf('<h2>Alpha</h2>')<html.indexOf('<h2>Zelda &amp; Friends</h2>'));
 assert(html.includes('Keep &lt;safe&gt;')&&!html.includes('Keep <safe>'));
 assert(html.includes('href="https://en.wikipedia.org/wiki/Zelda"'));
 assert(html.includes('E10+ - Everyone 10+'));
 assert(html.includes('<b>Replay on</b><span>Steam, Switch 2</span>'));
 assert.equal(selectPdfLibrary(library,'all').games.length,2);
 assert.equal(selectPdfLibrary(library,'physical').games.length,1);
 assert.equal(selectPdfLibrary(library,'physical').games[0].values.Title,'Zelda & Friends');
 assert.equal(selectPdfLibrary(library,'physical').hardware.length,3);
 console.log('PASS: PDF cover totals, chronological console/peripheral/game groups, independent peripheral numbering, section page separation, safe text and clickable links.');
}finally{rmSync(dir,{recursive:true,force:true});}
