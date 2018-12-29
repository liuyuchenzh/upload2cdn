const fs = require('fs')
const fse = require('fs-extra')
const path = require('path')
const {
  compatCache,
  parallel,
  beforeUpload: beforeProcess
} = require('y-upload-utils')
const name = 'upload2cdn'
const DEFAULT_SEP = '/'
const FILTER_OUT_DIR = [
  '.idea',
  '.vscode',
  '.gitignore',
  'node_modules',
  '.DS_Store'
]

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

const read = location => fs.readFileSync(location, 'utf-8')

const write = location => content => fs.writeFileSync(location, content)

/**
 * produce RegExp to match local path
 * @param {string} localPath
 * @param {string} fromPath
 * @param {boolean=} loose
 * @return {RegExp}
 */
function generateLocalPathReg(localPath, fromPath, loose = false) {
  const relativePath = path.relative(fromPath, localPath)
  const normalRelPath = normalize(relativePath)
  const pathArr = normalRelPath.split(DEFAULT_SEP)
  const char = loose ? '?' : ''
  // the file must be matched exactly
  const regStr =
    `\\.?\\/?` +
    pathArr
      .map(item => {
        if (item === '..') {
          return `\\.${char}\\.${char}`
        }
        return item.replace(/\./g, `\\.${char}`)
      })
      .join(`\\${DEFAULT_SEP}`)
  return new RegExp(regStr, 'g')
}

/**
 * find file usage
 * 1. make sure the range: srcPath
 * 2. provide inline path to search and to replace with: localCdnPair
 * @param {string} srcPath
 * @param {string=} distPath
 * @param {function=} shouldReplace
 * @param {boolean=} loose
 * @return {function}
 */
function simpleReplace(
  srcPath,
  distPath = srcPath,
  shouldReplace = () => true,
  loose = false
) {
  const srcFile = read(srcPath)
  const srcDir = path.resolve(srcPath, '..')

  return function savePair(localCdnPair) {
    const ret = localCdnPair.reduce((last, [local, cdn]) => {
      const localPath = normalize(local)
      const cdnPath = cdn
      const localPathReg = generateLocalPathReg(
        localPath,
        normalize(srcDir),
        loose
      )
      last = last.replace(localPathReg, (match, ...args) => {
        // given [offset - 20, offset + match.length + 20]
        // decide whether to replace the local path with cdn url
        const shift = 20
        const [offset, str] = args.slice(-2)
        const sliceStart = Math.max(0, offset - shift)
        const sliceEnd = Math.min(last.length, offset + match.length + shift)
        if (shouldReplace(str.slice(sliceStart, sliceEnd), localPath)) {
          return cdnPath
        }
        return match
      })
      return last
    }, srcFile)
    fse.ensureFileSync(distPath)
    write(distPath)(ret)
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
  const [file, src, dist] = [srcFilePath, srcRoot, distRoot].map(p =>
    normalize(p)
  )
  return file.replace(src, dist)
}

const imgTypeArr = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'ico', 'mp3', 'mp4']
const fontTypeArr = ['woff', 'woff2', 'ttf', 'oft', 'svg', 'eot']
const ASSET_TYPE = [...imgTypeArr, ...fontTypeArr, 'js', 'css']
const isCss = isType('css')
const isJs = isType('js')

function isFont(path) {
  return fontTypeArr.some(type => isType(type)(path))
}

function isImg(path) {
  return imgTypeArr.some(type => isType(type)(path))
}

/**
 * collect everything
 * @param {function(string)} gatherFn
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
      } else {
        last.extra = last.extra.concat(files)
      }
      return last
    },
    {
      all: [],
      img: [],
      js: [],
      font: [],
      css: [],
      extra: []
    }
  )
}

/**
 * @typedef {function(string): string} urlCb
 * @typedef {function(string[]): Promise<object>} uploadFn
 * @typedef {(content: string, location: string) => string} preProcess
 * @typedef {(slice: string, localFile: string) => boolean} shouldReplace
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
 * @param {function=} option.beforeUpload
 * @param {number=} option.sliceLimit
 * @param {string[]=} option.files
 * @param {preProcess=} option.preProcess
 * @param {shouldReplace=} option.shouldReplace
 * @param {string=} option.extraTypes
 * @param {function=} option.shapeExtra
 * @param {boolean=} option.loose
 */
async function upload(cdn, option = {}) {
  const {
    src = resolve('src'),
    dist = src,
    assets = resolve('src'),
    resolve: resolveList = ['html'],
    urlCb = input => input,
    replaceInJs = true,
    onFinish = () => {},
    passToCdn,
    enableCache = true,
    cacheLocation,
    beforeUpload,
    sliceLimit,
    files = [],
    preProcess = input => input,
    shouldReplace = () => true,
    extraTypes = [],
    shapeExtra = input => input,
    loose = false
  } = option
  if (!enableCache && cacheLocation) {
    log(
      `WARNING! 'cacheLocation' provided while haven't set 'enableCache' to true`
    )
    log(`WARNING! This won't enable cache`)
  }
  log('start...')
  // all assets including js/css/img
  let assetsFiles = []
  const ALL_TYPES = [...extraTypes, ...ASSET_TYPE]
  // if providing files field use files over src
  if (files.length) {
    const isFilesValid = files.every(file => path.isAbsolute(file))
    if (!isFilesValid) {
      return log(
        `WARNING! 'files' filed contains non-absolute path! Replace with absolute ones!`
      )
    }
    assetsFiles = autoGatherFilesInAsset(
      type => files.filter(file => path.extname(file) === `.${type}`),
      ALL_TYPES
    )
  } else {
    const gatherFileInAssets = gatherFileIn(assets)
    assetsFiles = autoGatherFilesInAsset(gatherFileInAssets, ALL_TYPES)
  }

  // closure with passToCdn
  const rawCdn = {
    upload(files) {
      return cdn.upload(files, passToCdn)
    }
  }

  // wrap with parallel
  const paralleledCdn = parallel(rawCdn, { sliceLimit })

  // wrap with cache
  const wrappedCdn = enableCache
    ? compatCache(paralleledCdn, {
        passToCdn,
        cacheLocation,
        beforeUpload
      })
    : paralleledCdn

  // wrap with beforeProcess
  // use beforeUpload properly
  const useableCdn = beforeProcess(wrappedCdn, beforeUpload)

  const { img, css, js, font, all, extra } = assetsFiles

  // preProcess all files to convert computed path to static path
  all.forEach(filePath => {
    const fileContent = read(filePath)
    const newContent = preProcess(fileContent, filePath)
    if (fileContent === newContent) {
      return
    }
    write(filePath)(newContent)
  })

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

  // update reference in extra
  extra.forEach(name => {
    simpleReplace(name, name, shouldReplace, loose)(
      processCdnUrl(Object.entries(imgAndFontPairs), urlCb)
    )
  })

  // upload extra types of files
  let extraPairs = {}
  const uploadExtra = async () => {
    if (extra.length) {
      log('uploading extra...')
      try {
        extraPairs = await useableCdn.upload(extra)
      } catch (e) {
        log('error occurred')
        log(e, 'error')
        return
      }
    }
  }

  await uploadExtra()

  // re-organize extra
  // in case there is dependency among them
  shapeExtra(extra).forEach(name => {
    simpleReplace(name, name, shouldReplace, loose)(
      processCdnUrl(
        Object.entries({ ...extraPairs, ...imgAndFontPairs }),
        urlCb
      )
    )
  })

  await uploadExtra()

  // update css + js files with cdn img/font
  const replaceFiles = replaceInJs
    ? [...js, ...css, ...extra]
    : [...css, ...extra]
  replaceFiles.forEach(name => {
    simpleReplace(name, name, shouldReplace, loose)(
      processCdnUrl(
        Object.entries({ ...extraPairs, ...imgAndFontPairs }),
        urlCb
      )
    )
  })

  // concat js + css + img
  log(`uploading js + css`)
  const adjustedFiles = all
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
    simpleReplace(
      filePath,
      mapSrcToDist(filePath, src, dist),
      shouldReplace,
      loose
    )(processCdnUrl(localCdnPair, urlCb))
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
