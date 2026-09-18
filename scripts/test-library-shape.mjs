import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {withCurrentLibraryShape,preferredSourceUrl,dedupeSources,orderedSources}=createRequire(import.meta.url)('../desktop-dist/library.cjs');

const original={revision:4,fields:[
 {id:'title',name:'Title',type:'text',options:[]},
 {id:'legacy-link',name:'Link',type:'url',options:[]},
 {id:'price',name:'Target Price',type:'number',options:[]},
 {id:'priority',name:'Wishlist Priority',type:'multi_select',options:['Must have','Want soon','Someday']},
],games:[{id:'one',values:{title:'Example','legacy-link':'https://youtu.be/video','price':25,priority:['Want soon','Someday']},dateEnd:'2027-02-03',dateIsTime:0,lookup:{description:'It&#x27;s fun &amp; polished.',sources:[{name:'Wikipedia',url:'https://en.wikipedia.org/wiki/Example'},{name:'Website',url:'https://www.pricecharting.com/game/example'}]}}]};
const next=withCurrentLibraryShape(original);
assert.deepEqual(next.fields.map(field=>field.name),['Title','Wishlist Priority']);
assert.deepEqual(next.fields[1].options,['Must have','Someday']);
assert.equal(next.games[0].values['legacy-link'],undefined);
assert.equal(next.games[0].values.price,undefined);
assert.deepEqual(next.games[0].values.priority,['Someday']);
assert.equal(next.games[0].dateEnd,undefined);
assert.equal(next.games[0].dateIsTime,undefined);
assert.equal(next.games[0].lookup.sources.at(-1).name,'YouTube');
assert.equal(next.games[0].lookup.sources.find(source=>source.url.includes('pricecharting.com')).name,'PriceCharting');
assert.equal(next.games[0].lookup.description,"It's fun & polished.");
assert.equal(original.fields.length,4,'Migration must not mutate its input');
assert.deepEqual(withCurrentLibraryShape(next),next,'Migration must be safe to run more than once');
assert.equal(preferredSourceUrl([{name:'Steam',url:'steam'},{name:'HowLongToBeat',url:'hltb'},{name:'Wikipedia',url:'wiki'},{name:'YouTube',url:'youtube'},{name:'IGN',url:'ign'}]),'ign');
assert.equal(preferredSourceUrl([{name:'Steam',url:'steam'},{name:'HowLongToBeat',url:'hltb'},{name:'Wikipedia',url:'wiki'},{name:'YouTube',url:'youtube'}]),'youtube');
assert.equal(preferredSourceUrl([{name:'Steam',url:'steam'},{name:'HowLongToBeat',url:'hltb'}]),'hltb');
assert.equal(preferredSourceUrl([{name:'Steam',url:'steam'}]),'');
assert.deepEqual(dedupeSources([{name:'Wikipedia',url:'https://en.wikipedia.org/?curid=1'},{name:'HowLongToBeat',url:'hltb'},{name:'Wikipedia',url:'https://en.wikipedia.org/wiki/Example'}]),[{name:'HowLongToBeat',url:'hltb'},{name:'Wikipedia',url:'https://en.wikipedia.org/wiki/Example'}]);
assert.deepEqual(orderedSources([{name:'Website',url:'site'},{name:'PriceCharting',url:'price'},{name:'Wikipedia',url:'wiki'},{name:'IGN',url:'ign'},{name:'HowLongToBeat',url:'hltb'},{name:'Steam',url:'steam'},{name:'YouTube',url:'youtube'}]).map(source=>source.name),['YouTube','IGN','Steam','Wikipedia','HowLongToBeat','PriceCharting','Website']);
console.log('PASS: retired fields and date ranges are removed, legacy links become sources, Want Soon is removed, and card links follow source priority.');
