import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {collectionPdfHtml,selectPdfLibrary}=require('../desktop-dist/pdf-export.cjs');
const dir=mkdtempSync(join(tmpdir(),'gameatlas-pdf-test-'));
try{
 const library={revision:1,fields:[],hardware:[{id:'console',name:'Nintendo Test System',type:'Console',manufacturer:'Nintendo',model:'Launch model',releaseDate:'2026-01-01',notes:'Boxed'}],games:[
  {id:'2',values:{Title:'Zelda & Friends',Platform:['Switch'],Ownership:['Physical'],Score:9,ESRB:'E10+ — Everyone 10+',Status:['Must Play'],Genre:['Adventure'],Studio:'Nintendo',Notes:'Keep <safe>'},lookup:{sources:[{name:'Wikipedia',url:'https://en.wikipedia.org/wiki/Zelda'}]}},
  {id:'1',values:{Title:'Alpha',Ownership:['Digital'],Studio:'Studio'}}
 ]};
 const html=collectionPdfHtml(library,dir,new Date('2026-09-15T12:00:00Z'),'Entire Library Catalog');
 assert(html.includes('Entire Library Catalog'));
 assert(html.includes('alt="GameAtlas icon"'));
 assert(html.includes('data:image/png;base64,'));
 assert(html.includes('<b>2</b><span>Total games</span>'));
 assert(html.includes('<b>1</b><span>Consoles</span>'));
 assert(html.indexOf('Nintendo Test System')<html.indexOf('Your games'));
 assert(html.indexOf('<h2>Alpha</h2>')<html.indexOf('<h2>Zelda &amp; Friends</h2>'));
 assert(html.includes('Keep &lt;safe&gt;')&&!html.includes('Keep <safe>'));
 assert(html.includes('href="https://en.wikipedia.org/wiki/Zelda"'));
 assert(html.includes('E10+ - Everyone 10+'));
 assert.equal(selectPdfLibrary(library,'all').games.length,2);
 assert.equal(selectPdfLibrary(library,'physical').games.length,1);
 assert.equal(selectPdfLibrary(library,'physical').games[0].values.Title,'Zelda & Friends');
 assert.equal(selectPdfLibrary(library,'physical').hardware.length,1);
 console.log('PASS: PDF catalog totals, alphabetical order, pertinent fields, safe text and clickable links.');
}finally{rmSync(dir,{recursive:true,force:true});}
