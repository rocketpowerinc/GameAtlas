import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {collectionStats}=createRequire(import.meta.url)('../desktop-dist/collection-stats.cjs');
const fields=['Title','Ownership','Status','Platform','Genre','Score'].map(name=>({id:'field-'+name,name,type:'text',options:[]}));
const game=(id,values)=>({id,values:Object.fromEntries(Object.entries(values).map(([k,v])=>['field-'+k,v]))});
const games=[
 game('both',{Title:'Both formats',Ownership:['Physical','Digital'],Status:['Complete','Backlog'],Platform:['PC','PC','Switch'],Genre:['RPG'],Score:0}),
 game('backlog',{Title:'Unplayed',Ownership:['Physical'],Status:['Backlog'],Platform:['Switch'],Score:'9.5'}),
 game('playing',{Title:'Playing',Ownership:['Digital'],Status:['Currently Playing','Backlog'],Score:''}),
 game('unknown',{Title:'Unknown',Ownership:['Physical'],Score:' '}),
 game('wishlist',{Title:'Wanted',Ownership:['Wish List'],Status:['Complete'],Platform:['PC'],Score:10}),
 game('unclassified',{Title:'Unclassified',Score:8}),
];
const s=collectionStats({fields,games,revision:1});
assert.equal(s.owned.length,4);assert.equal(s.total.length,6);assert.equal(s.completed.length,1);
assert.equal(s.backlog.length,1);assert.equal(s.playing.length,1);assert.equal(s.unspecified.length,1);
assert.equal(s.wishlist.length,1);assert.equal(s.completion,25);assert.equal(s.physical.length,3);assert.equal(s.digital.length,2);
assert.equal(s.platforms.find(p=>p.label==='PC').games.length,1);
assert.equal(s.platforms.find(p=>p.label==='Switch').games.length,2);
assert.equal(s.platforms.find(p=>p.label==='Not specified').games.length,2);
assert.equal(s.rated.length,2);assert.equal(s.rated[0].game.id,'backlog');assert.equal(s.average,4.75);
const empty=collectionStats({fields:[],games:[],revision:1});assert.equal(empty.completion,0);assert.equal(empty.average,null);
assert.equal(collectionStats({fields,games:[game('bad',{Ownership:['Digital'],Score:true})],revision:1}).rated.length,0);
console.log('PASS: dashboard counts, overlapping ownership/status, unknown status, wishlist exclusion, deduplicated platforms, custom field IDs, empty library and valid zero scores.');
