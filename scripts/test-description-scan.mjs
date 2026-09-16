import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {DescriptionScan}=require('../desktop-dist/description-scan.cjs');

let library={revision:1,fields:[{id:'Title',name:'Title',type:'text',options:[]}],games:[
 {id:'one',values:{Title:'Alpha'},lookup:{coverUrl:'https://images.example/alpha.jpg',sources:[{name:'IGN',url:'https://ign.example/alpha'}]}},
 {id:'two',values:{Title:'Beta'},lookup:{description:'Keep this description.',sources:[]}},
 {id:'three',values:{Title:'Gamma'}},
]};
let saves=0;
const store={read:()=>structuredClone(library),save:next=>{library=structuredClone(next);saves++;}};
const scan=new DescriptionScan(store,{
 search:async title=>({candidates:title==='Alpha'?[{name:'Alpha',wikiId:1}]:title==='Gamma'?[{name:'Gamma',wikiId:2},{name:'Gamma',steamId:3}]:[]}),
 details:async candidate=>({values:{},sources:[{name:'Wikipedia',url:'https://wikipedia.example/alpha'}],description:candidate.name==='Alpha'?'A new description.':''})
});
const result=await scan.run();
assert.deepEqual(result,{total:2,processed:2,added:1,missing:1});
assert.equal(saves,1);
assert.equal(library.games[0].lookup.description,'A new description.');
assert.equal(library.games[0].lookup.coverUrl,'https://images.example/alpha.jpg');
assert.deepEqual(library.games[0].lookup.sources.map(source=>source.name),['IGN','Wikipedia']);
assert.equal(library.games[1].lookup.description,'Keep this description.');
assert.equal(library.games[2].lookup,undefined);
console.log('PASS: missing descriptions fill exact matches, preserve existing descriptions and artwork, merge sources, and skip ambiguous games.');
