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
  {id:'2',values:{Title:'Zelda & Friends',Platform:['Switch'],Ownership:['Physical'],Score:9,ESRB:'E10+ — Everyone 10+',Status:['Must Play'],Genre:['Adventure'],Studio:'Nintendo',Notes:'Keep <safe>'},lookup:{sources:[{name:'Wikipedia',url:'https://en.wikipedia.org/wiki/Zelda'}]}},
  {id:'1',values:{Title:'Alpha',Ownership:['Digital'],Studio:'Studio'}}
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
 assert(html.includes('class="catalog games-catalog"')&&html.includes('.games-catalog{break-before:page;page-break-before:always}'));
 assert(html.indexOf('<h2>Alpha</h2>')<html.indexOf('<h2>Zelda &amp; Friends</h2>'));
 assert(html.includes('Keep &lt;safe&gt;')&&!html.includes('Keep <safe>'));
 assert(html.includes('href="https://en.wikipedia.org/wiki/Zelda"'));
 assert(html.includes('E10+ - Everyone 10+'));
 assert.equal(selectPdfLibrary(library,'all').games.length,2);
 assert.equal(selectPdfLibrary(library,'physical').games.length,1);
 assert.equal(selectPdfLibrary(library,'physical').games[0].values.Title,'Zelda & Friends');
 assert.equal(selectPdfLibrary(library,'physical').hardware.length,3);
 console.log('PASS: PDF cover totals and order, chronological hardware groups, hardware/game page separation, alphabetical games, safe text and clickable links.');
}finally{rmSync(dir,{recursive:true,force:true});}
