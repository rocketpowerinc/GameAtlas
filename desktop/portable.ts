import {join} from 'node:path';

export function portableUserData(environment:NodeJS.ProcessEnv=process.env){
 const directory=environment.PORTABLE_EXECUTABLE_DIR;
 const executable=environment.PORTABLE_EXECUTABLE_FILE;
 return directory&&executable?join(directory,'GameAtlas Data'):null;
}
