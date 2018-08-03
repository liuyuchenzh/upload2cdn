# upload2cdn

## Intro

Simple tool to upload files to cdn

## Environment requirement

node >= 8

## Install

```bash
npm install upload2cdn
```

## Notice

This tool does not provide a service as uploading to cdn.<br>
In fact, it actually depends on such service.<br>

## Dependency

`upload2cdn` relies on the existence a `cdn` object with an `upload` method described as below.

```typescript
type cdnUrl = string
interface cdnRes {
  [localPath: string]: cdnUrl
}
// this is what cdn package looks like
interface cdn {
  upload: (localPaths: string[]) => Promise<cdnRes>
}
```

If typescript syntax is unfamiliar, here is another description in vanilla javascript.

```js
/**
 * @param {string[]} localPath: list of paths of local files
 * @return Promise<cdnRes>: resolved Promise with structure like {localPath: cdnUrl}
 */
function upload(localPath) {
  // code
}
const cdn = {
  upload
}
```

## Usage

```js
const { upload } = require('upload2cdn')
const cdn = require('some-cdn-package')
upload(cdn, {
  src: path.resolve('./src'), // where your html file would emit to (with reference to local js/css files)
  dist: path.resolve('./dist'), // only use this when there is a need to separate origin outputs with cdn ones
  assets: path.resolve('./src'), // where all assets lie, most likely the same as src property
  urlCb(input) {
    return input
  }, // give the power to play with cdn url before emit
  resolve: ['html'], // typeof file needed to match; default to ['html']
  onFinish() {}, // anything you want to run after the uploading and replacing process
  replaceInJs: true, // wether to match local path of img/font (contained in assets directory) in js files and replace them with cdn ones
  enableCache: false, // switch to enable cache file of upload result
  cacheLocation: __dirname, // place to emit cache file
  beforeUpload(content, fileLocation) {}, // invoked before upload. Compression can be done here. Argument content is String type and you need to return compressed/updated content in String type too
})
```

> `src`, `dist`, `assets` work best with absolute path!

`src`, `dist` and `assets` are only three required

## License

[MIT](http://opensource.org/licenses/MIT)

Copyright (c) 2017-present, Yuchen Liu
