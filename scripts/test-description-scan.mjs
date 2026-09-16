import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {DescriptionScan,missingDescriptionText}=require('../desktop-dist/description-scan.cjs');

let library={revision:1,fields:[{id:'Title',name:'Title',type:'text',options:[]}],games:[
 {id:'one',values:{Title:'Alpha',Platform:['Switch']},lookup:{coverUrl:'https://images.example/alpha.jpg',sources:[{name:'IGN',url:'https://ign.example/alpha'}]}},
 {id:'two',values:{Title:'Beta'},lookup:{description:'Keep this description.',sources:[]}},
 {id:'three',values:{Title:'Gamma'},lookup:{description:missingDescriptionText}},
]};
let saves=0;
const store={read:()=>structuredClone(library),save:next=>{library=structuredClone(next);saves++;}};
const scan=new DescriptionScan(store);
assert.deepEqual(scan.missing(),[
 {id:'one',title:'Alpha',platform:'Switch'},
 {id:'three',title:'Gamma',platform:'Platform not set'}
]);
scan.apply('one','  A manually added description.  ');
assert.equal(saves,1);
assert.equal(library.games[0].lookup.description,'A manually added description.');
assert.equal(library.games[0].lookup.coverUrl,'https://images.example/alpha.jpg');
assert.deepEqual(library.games[0].lookup.sources.map(source=>source.name),['IGN']);
assert.equal(library.games[1].lookup.description,'Keep this description.');
assert.throws(()=>scan.apply('three',''),/Enter a description/);
assert.throws(()=>scan.apply('three',missingDescriptionText),/Enter a description/);
assert.equal(scan.missing().length,1);
console.log('PASS: missing descriptions include blank and placeholder entries, accept manual text, and preserve artwork and sources.');
