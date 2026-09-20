import {rmSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const generated=['release','output','dist','desktop-dist'];

for(const name of generated){
 const target=resolve(join(root,name));
 if(relative(root,target)!==name)throw new Error(`Refusing to clean unexpected path: ${target}`);
 rmSync(target,{recursive:true,force:true});
 console.log(`Removed ${name}`);
}
