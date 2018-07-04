const fs = require('fs')
const fse = require('fs-extra')
const path = require('path')
const { compatCache, parallel } = require('y-upload-utils')
const name = require('./package.json').name
const DEFAULT_SEP = '/'
const FILTER_OUT_DIR = [
  '.idea',
  '.vscode',
  '.gitignore',
  'node_modules',
  '.DS_Store'
]
const ASSET_TYPE = [
  'js',
  'css',
  'jpg',
  'png',
  'gif',
  'svg',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot'
]
const DEFAULT_OPTION = {
  src: resolve('src'),
  dist: resolve('src'),
  resolve: ['html'],
  urlCb(input) {
    return input
  },
  replaceInJs: false
}

// 1. gather html file
// 2. gather production file
// 3. upload all production file
// 4. find the usage of production file in html file
// 5. if found, replace

function resolve(...input) {
  return path.resolve(...input)
}

function normalize(input, sep = DEFAULT_SEP) {
  const _input = path.normalize(input)
  return _input.split(path.sep).join(sep)
}

function isFilterOutDir(input) {
  return FILTER_OUT_DIR.includes(input)
}

function generateLog(name) {
  return function log(input, mode = 'log') {
    console[mode](`[${name}]: `, input)
  }
}

const log = generateLog(name)

/**
 * produce RegExp to match local path
 * @param {string} localPath
 * @return {RegExp}
 */
function generateLocalPathReg(localPath) {
  const pathArr = localPath.split(DEFAULT_SEP)
  // the file must be matched exactly
  const file = pathArr.pop()
  const regStr =
    pathArr.map(part => `\\.*?(${part})?`).join(`\\${DEFAULT_SEP}?`) +
    `\\${DEFAULT_SEP}?` +
    file.replace(/\./, '\\.')
  return new RegExp(regStr, 'g')
}

/**
 * find file usage
 * 1. make sure the range: srcPath
 * 2. provide inline path to search and to replace with: localCdnPair
 * @param {string} srcPath
 * @param {string} distPath
 * @return {function}
 */
function simpleReplace(srcPath, distPath = srcPath) {
  const srcFile = fs.readFileSync(srcPath, 'utf-8')
  return function savePair(localCdnPair) {
    const ret = localCdnPair.reduce((last, [local, cdn]) => {
      const localPath = normalize(local)
      const cdnPath = cdn
      const localPathReg = generateLocalPathReg(localPath)
      last = last.replace(localPathReg, match => cdnPath)
      return last
    }, srcFile)
    fse.ensureFileSync(distPath)
    fs.writeFileSync(distPath, ret)
  }
}

/**
 * gather specific file type within directory provided
 * 1. provide range to search: src
 * 2. provide the type of file to search: type
 * @param {string} src: directory to search
 * @return {function}
 */
function gatherFileIn(src) {
  return function gatherFileType(type) {
    return fs.readdirSync(src).reduce((last, file) => {
      const filePath = resolve(src, file)
      if (isFile(filePath)) {
        path.extname(file) === `.${type}` && last.push(normalize(filePath))
      } else if (isFilterOutDir(file)) {
        // do nothing
      } else if (isDir(filePath)) {
        last = last.concat(gatherFileIn(filePath)(type))
      }
      return last
    }, [])
  }
}

function isFile(input) {
  return fs.statSync(input).isFile()
}

function isDir(input) {
  return fs.statSync(input).isDirectory()
}

function isType(type) {
  return function enterFile(file) {
    return isFile(file) && path.extname(file) === '.' + type
  }
}

/**
 * give the power of playing with cdn url
 * @param {*[]} entries
 * @param {function} cb
 * @returns {[string, string][] | void}
 */
function processCdnUrl(entries, cb) {
  if (typeof cb !== 'function') log(`urlCb is not function`, 'error')
  return entries.map(([local, cdn]) => {
    // pair[1] should be cdn url
    const useableCdn = cb(cdn)
    if (typeof useableCdn !== 'string')
      log(`the return result of urlCb is not string`, 'error')
    return [local, useableCdn]
  })
}

function mapSrcToDist(srcFilePath, srcRoot, distRoot) {
  return srcFilePath.replace(srcRoot, distRoot)
}

const imgTypeArr = ['jpg', 'jpeg', 'png', 'gif', 'webp']
const fontTypeArr = ['woff', 'woff2', 'ttf', 'oft', 'svg', 'eot']
const isCss = isType('css')
const isJs = isType('js')
const isHTML = isType('html')

function isFont(path) {
  return fontTypeArr.some(type => isType(type)(path))
}

function isImg(path) {
  return imgTypeArr.some(type => isType(type)(path))
}

/**
 * collect everything
 * @param {function(string)}gatherFn
 * @param {string[]} typeList
 * @returns {{all: string[], js: string[], css: string[], img: string[], font: string[]}}
 */
function autoGatherFilesInAsset(gatherFn, typeList) {
  return typeList.reduce(
    (last, type) => {
      const files = gatherFn(type)
      if (!files.length) return last
      const [location] = files
      last.all = last.all.concat(files)
      if (isImg(location)) {
        last.img = last.img.concat(files)
      } else if (isCss(location)) {
        last.css = last.css.concat(files)
      } else if (isJs(location)) {
        last.js = last.js.concat(files)
      } else if (isFont(location)) {
        last.font = last.font.concat(files)
      }
      return last
    },
    {
      all: [],
      img: [],
      js: [],
      font: [],
      css: []
    }
  )
}

/**
 * @typedef {function(string): string} urlCb
 * @typedef {function(string[]): Promise<object>} uploadFn
 */

/**
 * custom cdn module, need to have an upload API, return a Promise with structured response
 * like {localPath: cdnPath}
 * @param {object} cdn
 * @param {uploadFn} cdn.upload
 * @param {object} option
 * @param {string} option.src
 * @param {string} option.assets
 * @param {string=} option.dist
 * @param {urlCb=} option.urlCb
 * @param {object=} option.passToCdn
 * @param {boolean=} option.enableCache
 * @param {string=} option.cacheLocation
 * @param {function=} option.onFinish
 */
async function upload(cdn, option = {}) {
  const {
    src = resolve('src'),
    dist = resolve('src'),
    assets = resolve('src'),
    resolve: resolveList = ['html'],
    urlCb = input => input,
    replaceInJs = true,
    onFinish = () => {},
    passToCdn,
    enableCache = false,
    cacheLocation
  } = option
  if (!enableCache && cacheLocation) {
    log(
      `WARNING! 'cacheLocation' provided while haven't set 'enableCache' to true`
    )
    log(`WARNING! This won't enable cache`)
  }
  log('start...')
  // all assets including js/css/img
  const gatherFileInAssets = gatherFileIn(assets)
  const assetsFiles = autoGatherFilesInAsset(gatherFileInAssets, ASSET_TYPE)

  const rawCdn = {
    upload(files) {
      return cdn.upload(files, passToCdn)
    }
  }

  const useableCdn = enableCache
    ? compatCache(parallel(rawCdn), {
        passToCdn,
        cacheLocation
      })
    : parallel(rawCdn)

  const { img, css, js, font } = assetsFiles

  // upload img/font
  // find img/font in css
  // replace css
  // now css ref to img/font with cdn path
  // meanwhile upload chunk files to save time
  log(`uploading img + font ...`)
  let imgAndFontPairs
  try {
    imgAndFontPairs = await useableCdn.upload([...img, ...font])
  } catch (e) {
    log('error occurred')
    log(e, 'error')
    return
  }

  // update css + js files with cdn img/font
  const replaceFiles = replaceInJs ? [...js, ...css] : css
  replaceFiles.forEach(name => {
    simpleReplace(name)(processCdnUrl(Object.entries(imgAndFontPairs), urlCb))
  })

  // concat js + css + img
  log(`uploading js + css`)
  const adjustedFiles = [...js, ...css, ...img]
  const findFileInRoot = gatherFileIn(src)
  const tplFiles = resolveList.reduce((last, type) => {
    last = last.concat(findFileInRoot(type))
    return last
  }, [])
  let jsCssImgPair
  try {
    jsCssImgPair = await useableCdn.upload(adjustedFiles)
  } catch (e) {
    log('error occurred')
    log(e, 'error')
    return
  }
  const localCdnPair = Object.entries(jsCssImgPair)
  tplFiles.forEach(filePath => {
    simpleReplace(filePath, mapSrcToDist(filePath, src, dist))(
      processCdnUrl(localCdnPair, urlCb)
    )
  })
  // run onFinish if it is a valid function
  onFinish()
  log(`all done`)
}

module.exports = {
  upload,
  gatherFileIn,
  autoGatherFilesInAsset
}
