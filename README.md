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

This tool does not provide a service as uploading to cdn.

In fact, it actually depends on such service.

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
  src: path.resolve('./src')
  dist: path.resolve('./dist')
  assets: path.resolve('./src')
})
```

> `src`, `dist`, `assets` work best with absolute path!

## Configuration

```js
upload(cdn, option)
```

For `option`, valid fields are showed below

### src: string

Where your template files would be (with reference to local js/css files)

### assets: string

Where all assets (js/css/images) are, most likely the same as src property.

### [dist]: string

Where to emit newer template with cdn reference.

Only use this when there is a need to separate origin templates with ones using cdn reference.

> Happens when original templates are static, aka not produced by any building tools.

### [urlCb]: (cdnUrl: string) => string

Further alter cdn url here.

```js
const urlCb = input => input.replace(/^https/, 'http')
```

### [enableCache=true]: boolean

Using cache to speed up, aka skip some uploading work.

### [cacheLocation]: string

Place to put cache file.

Use this only when you want to manage the cache file by VCS, which is unlikely.

### [onFinish]: () => any

Called when things are done.

Or you can simply `await` for `upload`, and then do your own thing.

### [beforeUpload]: (fileContent: string, fileLocation: string) => string

_Compression_ can be done here. Two arguments are fileContent and fileLocation (with extension name of course). You need to return the compression result as string.

```js
// if you want to compress js before upload
const UglifyJs = require('uglify-js')
const path = require('path')
const beforeUpload = (content, location) => {
  if (path.extname(location) === '.js') {
    return UglifyJs.minify(content).code
  }
  return content
}
```

### [sliceLimit=10]: number

Uploading files is not done by once. By using `sliceLimit`, you can limit the number of files being uploaded at once.

### [files]: string[]

When using, it basically means overriding `assets` field, and only use the files you provide as assets.

> Should be an array of _absolute_ locations.

### [preProcess]: (fileContent: string, fileLocation: string) => string

Give you the chance to update files' content before any further process.
Runs at the very beginning (including all valid files in `src` and `assets`), prior to any upload related process.

### [extraTypes]: string[]

Extra types needed to cdn. Like `json` (Do not prefix with `.`)

### [shouldReplace]: (slice: string, fileLocation: string) => boolean

Should replace the matching local path with the cdn url.
`slice` is a 20 characters + matched path + 20 characters

### [shapeExtra]: (extra: string[]) => string[]

If there are `extraTypes`, then will try to upload them twice.
The meaning of the second time is to handle the potential dependency among them.
And `shapeExtra` gives you a chance to change the order of those extra files.

> Probably do not need to use this.

## License

[MIT](http://opensource.org/licenses/MIT)

Copyright (c) 2017-present, Yuchen Liu
