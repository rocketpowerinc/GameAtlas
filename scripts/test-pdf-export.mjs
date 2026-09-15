import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {collectionPdfHtml}=require('../desktop-dist/pdf-export.cjs');
const dir=mkdtempSync(join(tmpdir(),'gameatlas-pdf-test-'));
try{
 const library={revision:1,fields:[],games:[
  {id:'2',values:{Title:'Zelda & Friends',Platform:['Switch'],Ownership:['Physical'],Score:9,ESRB:'E10+ — Everyone 10+',Status:['Must Play'],Genre:['Adventure'],Studio:'Nintendo',Notes:'Keep <safe>',Link:'https://example.com/game'}},
  {id:'1',values:{Title:'Alpha',Ownership:['Digital'],Studio:'Studio'}}
 ]};
 const html=collectionPdfHtml(library,dir,new Date('2026-09-15T12:00:00Z'));
 assert(html.includes('Complete Collection Catalog'));
 assert(html.includes('<b>2</b><span>Total games</span>'));
 assert(html.indexOf('<h2>Alpha</h2>')<html.indexOf('<h2>Zelda &amp; Friends</h2>'));
 assert(html.includes('Keep &lt;safe&gt;')&&!html.includes('Keep <safe>'));
 assert(html.includes('href="https://example.com/game"'));
 assert(html.includes('E10+ - Everyone 10+'));
 console.log('PASS: PDF catalog totals, alphabetical order, pertinent fields, safe text and clickable links.');
}finally{rmSync(dir,{recursive:true,force:true});}
