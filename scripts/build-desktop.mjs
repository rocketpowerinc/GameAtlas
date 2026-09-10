import {build} from 'esbuild';import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('desktop-dist',{recursive:true});
await build({entryPoints:['desktop/main.ts','desktop/store.ts'],bundle:true,platform:'node',format:'cjs',outdir:'desktop-dist',outExtension:{'.js':'.cjs'},external:['electron','node:sqlite'],target:'node22'});
await copyFile('desktop/preload.cjs','desktop-dist/preload.cjs');

