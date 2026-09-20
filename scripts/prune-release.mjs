import {readFileSync,readdirSync,rmSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const release=join(root,'release');
const {version}=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const keep=new Set([`GameAtlas.Setup.${version}.exe`,`GameAtlas.Portable.${version}.exe`]);

for(const entry of readdirSync(release,{withFileTypes:true})){
 if(keep.has(entry.name))continue;
 const target=join(release,entry.name);
 if(dirname(target)!==release)throw new Error(`Refusing to prune unexpected path: ${target}`);
 rmSync(target,{recursive:true,force:true});
}

console.log(`Kept only ${[...keep].map(name=>basename(name)).join(' and ')}`);
