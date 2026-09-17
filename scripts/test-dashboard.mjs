import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {collectionStats}=createRequire(import.meta.url)('../desktop-dist/collection-stats.cjs');
const fields=['Title','Ownership','Status','Tags','Platform','Genre','Score','Studio','Wishlist Priority','Release Date'].map(name=>({id:'field-'+name,name,type:'text',options:[]}));
const game=(id,values)=>({id,values:Object.fromEntries(Object.entries(values).map(([k,v])=>['field-'+k,v]))});
const games=[
 game('both',{Title:'Both formats',Ownership:['Physical','Digital'],Status:['Complete','Backlog'],Platform:['PC','PC','Switch'],Genre:['RPG'],Score:0}),
 game('backlog',{Title:'Unplayed',Ownership:['Physical'],Status:['Must Play'],Platform:['Switch'],Score:'9.5'}),
 game('playing',{Title:'Playing',Ownership:['Digital'],Status:['Currently Playing','Must Play'],Score:''}),
 game('unknown',{Title:'Unknown',Ownership:['Physical'],Score:' '}),
 game('wishlist',{Title:'Wanted',Ownership:['Wish List'],Status:['Complete'],Platform:['PC'],Score:10}),
 game('unclassified',{Title:'Unclassified',Score:8}),
 game('replay',{Title:'Replay me',Ownership:['Digital'],Status:['Replay']}),
];
const s=collectionStats({fields,games,revision:1});
assert.equal(s.owned.length,5);assert.equal(s.total.length,7);assert.equal(s.completed.length,1);
assert.equal(s.backlog.length,1);assert.equal(s.playing.length,1);assert.equal(s.unspecified.length,1);
assert.equal(s.mustPlay.length,2);assert.deepEqual(s.replay.map(g=>g.id),['replay']);
assert.equal(s.wishlist.length,1);assert.equal(s.completion,20);assert.equal(s.physical.length,3);assert.equal(s.digital.length,3);
assert.equal(s.upcoming.length,0);
assert.equal(s.platforms.find(p=>p.label==='PC').games.length,1);
assert.equal(s.platforms.find(p=>p.label==='Switch').games.length,2);
assert.equal(s.platforms.find(p=>p.label==='Not specified').games.length,3);
assert.equal(s.rated.length,2);assert.equal(s.rated[0].game.id,'backlog');assert.equal(s.average,4.75);
const empty=collectionStats({fields:[],games:[],revision:1});assert.equal(empty.completion,0);assert.equal(empty.average,null);
assert.equal(collectionStats({fields,games:[game('bad',{Ownership:['Digital'],Score:true})],revision:1}).rated.length,0);
console.log('PASS: dashboard counts, overlapping ownership/status, unknown status, wishlist exclusion, deduplicated platforms, custom field IDs, empty library and valid zero scores.');

const insights=collectionStats({fields,revision:1,games:[
 game('a',{Title:'Alpha',Ownership:['Physical','Digital'],Status:['Must Play'],Studio:'Studio One',Score:9}),
 game('b',{Title:'Beta',Ownership:['Digital'],Status:['Complete','Must Play'],Studio:'Studio One',Score:7}),
 game('c',{Title:'Gamma',Ownership:['Physical'],Status:['Currently Playing','Must Play'],Studio:'Studio Two',Score:10}),
 game('d',{Title:'Delta',Ownership:['Digital'],Status:['Must Play'],Studio:'Studio One',Score:''}),
 game('zero',{Title:'Zero',Ownership:['Digital'],Status:['Must Play'],Studio:'Studio Two',Score:0}),
 game('replay-tag',{Title:'Again',Ownership:['Physical'],Tags:['Replay'],Studio:'Studio Two',Score:8}),
 game('w1',{Title:'Future',Ownership:['Wish List'],'Wishlist Priority':['Must have','Someday'],'Release Date':'2026-09-13',Studio:'Studio One',Score:10}),
 game('w2',{Title:'Today',Ownership:['Wish List'],'Release Date':'2026-09-12'}),
 game('w3',{Title:'Unknown',Ownership:['Wish List'],'Release Date':'2026-02-30'}),
 game('w4',{Title:'Partial',Ownership:['Wish List'],'Wishlist Priority':['Custom priority'],'Release Date':'2026'}),
 game('future-all',{Title:'Future library game','Release Date':'2026-10-01'}),
]},new Date(2026,8,12,12));
assert.deepEqual(insights.unplayedRated.map(r=>r.game.id),['a','zero']);
assert.equal(insights.mustPlay.length,5);assert.deepEqual(insights.replay.map(g=>g.id),['replay-tag']);
assert.equal(insights.developers[0].label,'Studio One');
assert.equal(insights.developers[0].games.length,3);
assert.equal(insights.developers[0].ratedCount,2);
assert.equal(insights.developers[0].average,8);
assert.equal(insights.developers[1].average,6);
assert.equal(insights.wishlistPriorities.find(p=>p.label==='Must have').games.length,1);
assert.equal(insights.wishlistPriorities.find(p=>p.label==='Someday').games.length,1);
assert.equal(insights.wishlistPriorities.find(p=>p.label==='Not set').games.length,2);
assert.equal(insights.wishlistPriorities.find(p=>p.label==='Custom priority').games.length,1);
assert.deepEqual(insights.releaseGroups.upcoming.map(g=>g.id),['w1']);
assert.deepEqual(insights.upcoming.map(g=>g.id),['w1','future-all']);
assert.deepEqual(insights.releaseGroups.released.map(g=>g.id),['w2']);
assert.equal(insights.releaseGroups.unknown.length,2);
assert.equal(empty.unplayedRated.length,0);assert.equal(empty.developers.length,0);assert.equal(empty.upcoming.length,0);
console.log('PASS: unplayed rankings exclude playing/completed/wishlist, developer counts and score averages, multiple/custom/unset priorities, date boundaries and invalid dates.');
