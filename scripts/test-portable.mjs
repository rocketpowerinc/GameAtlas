import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join} from 'node:path';

const require=createRequire(import.meta.url);
const {portableUserData}=require('../desktop-dist/portable.cjs');

assert.equal(portableUserData({}),null);
assert.equal(portableUserData({PORTABLE_EXECUTABLE_DIR:'D:\\Apps'}),null);
assert.equal(portableUserData({PORTABLE_EXECUTABLE_FILE:'D:\\Apps\\GameAtlas.exe'}),null);
assert.equal(portableUserData({PORTABLE_EXECUTABLE_DIR:'D:\\Apps',PORTABLE_EXECUTABLE_FILE:'D:\\Apps\\GameAtlas.exe'}),join('D:\\Apps','GameAtlas Data'));
console.log('PASS: portable builds keep their complete GameAtlas data beside the executable and installed builds retain AppData storage.');
