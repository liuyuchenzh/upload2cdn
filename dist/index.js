// A type of promise-like that resolves synchronously and supports only one observer
const _Pact = (function() {
	function _Pact() {}
	_Pact.prototype.then = function(onFulfilled, onRejected) {
		const result = new _Pact();
		const state = this.s;
		if (state) {
			const callback = state & 1 ? onFulfilled : onRejected;
			if (callback) {
				try {
					_settle(result, 1, callback(this.v));
				} catch (e) {
					_settle(result, 2, e);
				}
				return result;
			} else {
				return this;
			}
		}
		this.o = function(_this) {
			try {
				const value = _this.v;
				if (_this.s & 1) {
					_settle(result, 1, onFulfilled ? onFulfilled(value) : value);
				} else if (onRejected) {
					_settle(result, 1, onRejected(value));
				} else {
					_settle(result, 2, value);
				}
			} catch (e) {
				_settle(result, 2, e);
			}
		};
		return result;
	};
	return _Pact;
})();

// Settles a pact synchronously
function _settle(pact, state, value) {
	if (!pact.s) {
		if (value instanceof _Pact) {
			if (value.s) {
				if (state & 1) {
					state = value.s;
				}
				value = value.v;
			} else {
				value.o = _settle.bind(null, pact, state);
				return;
			}
		}
		if (value && value.then) {
			value.then(_settle.bind(null, pact, state), _settle.bind(null, pact, 2));
			return;
		}
		pact.s = state;
		pact.v = value;
		const observer = pact.o;
		if (observer) {
			observer(pact);
		}
	}
}

// Asynchronously call a function and send errors to recovery continuation
function _catch(body, recover) {
	try {
		var result = body();
	} catch(e) {
		return recover(e);
	}
	if (result && result.then) {
		return result.then(void 0, recover);
	}
	return result;
}

// Sentinel value for early returns in generators 
const _earlyReturn = {};

// Asynchronous generator class; accepts the entrypoint of the generator, to which it passes itself when the generator should start
const _AsyncGenerator = (function() {
	function _AsyncGenerator(entry) {
		this._entry = entry;
		this._pact = null;
		this._resolve = null;
		this._return = null;
		this._promise = null;
	}

	function _wrapReturnedValue(value) {
		return { value: value, done: true };
	}
	function _wrapYieldedValue(value) {
		return { value: value, done: false };
	}

	_AsyncGenerator.prototype[Symbol.asyncIterator || (Symbol.asyncIterator = Symbol("Symbol.asyncIterator"))] = function() {
		return this;
	};
	_AsyncGenerator.prototype._yield = function(value) {
		// Yield the value to the pending next call
		this._resolve(value && value.then ? value.then(_wrapYieldedValue) : _wrapYieldedValue(value));
		// Return a pact for an upcoming next/return/throw call
		return this._pact = new _Pact();
	};
	_AsyncGenerator.prototype.next = function(value) {
		// Advance the generator, starting it if it has yet to be started
		const _this = this;
		return _this._promise = new Promise(function (resolve) {
			const _pact = _this._pact;
			if (_pact === null) {
				const _entry = _this._entry;
				if (_entry === null) {
					// Generator is started, but not awaiting a yield expression
					// Abandon the next call!
					return resolve(_this._promise);
				}
				// Start the generator
				_this._entry = null;
				_this._resolve = resolve;
				function returnValue(value) {
					_this._resolve(value && value.then ? value.then(_wrapReturnedValue) : _wrapReturnedValue(value));
					_this._pact = null;
					_this._resolve = null;
				}
				_entry(_this).then(returnValue, function(error) {
					if (error === _earlyReturn) {
						returnValue(_this._return);
					} else {
						const pact = new _Pact();
						_this._resolve(pact);
						_this._pact = null;
						_this._resolve = null;
						_resolve(pact, 2, error);
					}
				});
			} else {
				// Generator is started and a yield expression is pending, settle it
				_this._pact = null;
				_this._resolve = resolve;
				_settle(_pact, 1, value);
			}
		});
	};
	_AsyncGenerator.prototype.return = function(value) {
		// Early return from the generator if started, otherwise abandons the generator
		const _this = this;
		return _this._promise = new Promise(function (resolve) {
			const _pact = _this._pact;
			if (_pact === null) {
				if (_this._entry === null) {
					// Generator is started, but not awaiting a yield expression
					// Abandon the return call!
					return resolve(_this._promise);
				}
				// Generator is not started, abandon it and return the specified value
				_this._entry = null;
				return resolve(value && value.then ? value.then(_wrapReturnedValue) : _wrapReturnedValue(value));
			}
			// Settle the yield expression with a rejected "early return" value
			_this._return = value;
			_this._resolve = resolve;
			_this._pact = null;
			_settle(_pact, 2, _earlyReturn);
		});
	};
	_AsyncGenerator.prototype.throw = function(error) {
		// Inject an exception into the pending yield expression
		const _this = this;
		return _this._promise = new Promise(function (resolve, reject) {
			const _pact = _this._pact;
			if (_pact === null) {
				if (_this._entry === null) {
					// Generator is started, but not awaiting a yield expression
					// Abandon the throw call!
					return resolve(_this._promise);
				}
				// Generator is not started, abandon it and return a rejected Promise containing the error
				_this._entry = null;
				return reject(error);
			}
			// Settle the yield expression with the value as a rejection
			_this._resolve = resolve;
			_this._pact = null;
			_settle(_pact, 2, error);
		});
	};
	
	return _AsyncGenerator;
})();

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
var upload = function (cdn, option) {
  if ( option === void 0 ) option = {};

  try {
    var _exit = false;

    function _temp4(_result) {
      if (_exit) { return _result; }
      // update reference in extra
      extra.forEach(function (name) {
        simpleReplace(name, name, shouldReplace, loose)(processCdnUrl(Object.entries(imgAndFontPairs), urlCb));
      }); // upload extra types of files

      var extraPairs = {};

      var uploadExtra = function () {
        try {
          var _temp6 = function () {
            if (extra.length) {
              log('uploading extra...');

              var _temp5 = _catch(function () {
                return Promise.resolve(useableCdn.upload(extra)).then(function (_useableCdn$upload3) {
                  extraPairs = _useableCdn$upload3;
                });
              }, function (e) {
                log('error occurred');
                log(e, 'error');
              });

              if (_temp5 && _temp5.then) { return _temp5.then(function () {}); }
            }
          }();

          return Promise.resolve(_temp6 && _temp6.then ? _temp6.then(function () {}) : void 0);
        } catch (e) {
          return Promise.reject(e);
        }
      };

      return Promise.resolve(uploadExtra()).then(function () {
        // re-organize extra
        // in case there is dependency among them
        shapeExtra(extra).forEach(function (name) {
          simpleReplace(name, name, shouldReplace, loose)(processCdnUrl(Object.entries(Object.assign({}, extraPairs,
            imgAndFontPairs)), urlCb));
        });
        return Promise.resolve(uploadExtra()).then(function () {
          var _exit2 = false;

          function _temp2(_result2) {
            if (_exit2) { return _result2; }
            var localCdnPair = Object.entries(jsCssImgPair);
            tplFiles.forEach(function (filePath) {
              simpleReplace(filePath, mapSrcToDist(filePath, src, dist), shouldReplace, loose)(processCdnUrl(localCdnPair, urlCb));
            }); // run onFinish if it is a valid function

            onFinish();
            log("all done");
          }

          // update css + js files with cdn img/font
          var replaceFiles = replaceInJs ? js.concat( css, extra) : css.concat( extra);
          replaceFiles.forEach(function (name) {
            simpleReplace(name, name, shouldReplace, loose)(processCdnUrl(Object.entries(Object.assign({}, extraPairs,
              imgAndFontPairs)), urlCb));
          }); // concat js + css + img

          log("uploading js + css");
          var adjustedFiles = all;
          var findFileInRoot = gatherFileIn(src);
          var tplFiles = resolveList.reduce(function (last, type) {
            last = last.concat(findFileInRoot(type));
            return last;
          }, []);
          var jsCssImgPair;

          var _temp = _catch(function () {
            return Promise.resolve(useableCdn.upload(adjustedFiles)).then(function (_useableCdn$upload2) {
              jsCssImgPair = _useableCdn$upload2;
            });
          }, function (e) {
            log('error occurred');
            log(e, 'error');
            _exit2 = true;
          });

          return _temp && _temp.then ? _temp.then(_temp2) : _temp2(_temp);
        });
      });
    }

    var src = option.src; if ( src === void 0 ) src = resolve('src');
    var dist = option.dist; if ( dist === void 0 ) dist = src;
    var assets = option.assets; if ( assets === void 0 ) assets = resolve('src');
    var resolveList = option.resolve; if ( resolveList === void 0 ) resolveList = ['html'];
    var urlCb = option.urlCb; if ( urlCb === void 0 ) urlCb = function (input) { return input; };
    var replaceInJs = option.replaceInJs; if ( replaceInJs === void 0 ) replaceInJs = true;
    var onFinish = option.onFinish; if ( onFinish === void 0 ) onFinish = function () {};
    var passToCdn = option.passToCdn;
    var enableCache = option.enableCache; if ( enableCache === void 0 ) enableCache = true;
    var cacheLocation = option.cacheLocation;
    var beforeUpload = option.beforeUpload;
    var sliceLimit = option.sliceLimit;
    var files = option.files; if ( files === void 0 ) files = [];
    var preProcess = option.preProcess; if ( preProcess === void 0 ) preProcess = function (input) { return input; };
    var shouldReplace = option.shouldReplace; if ( shouldReplace === void 0 ) shouldReplace = function () { return true; };
    var extraTypes = option.extraTypes; if ( extraTypes === void 0 ) extraTypes = [];
    var shapeExtra = option.shapeExtra; if ( shapeExtra === void 0 ) shapeExtra = function (input) { return input; };
    var loose = option.loose; if ( loose === void 0 ) loose = false;

    if (!enableCache && cacheLocation) {
      log("WARNING! 'cacheLocation' provided while haven't set 'enableCache' to true");
      log("WARNING! This won't enable cache");
    }

    log('start...'); // all assets including js/css/img

    var assetsFiles = [];
    var ALL_TYPES = extraTypes.concat( ASSET_TYPE); // if providing files field use files over src

    if (files.length) {
      var isFilesValid = files.every(function (file) { return path.isAbsolute(file); });

      if (!isFilesValid) {
        return Promise.resolve(log("WARNING! 'files' filed contains non-absolute path! Replace with absolute ones!"));
      }

      assetsFiles = autoGatherFilesInAsset(function (type) { return files.filter(function (file) { return path.extname(file) === ("." + type); }); }, ALL_TYPES);
    } else {
      var gatherFileInAssets = gatherFileIn(assets);
      assetsFiles = autoGatherFilesInAsset(gatherFileInAssets, ALL_TYPES);
    } // closure with passToCdn


    var rawCdn = {
      upload: function upload(files) {
        return cdn.upload(files, passToCdn);
      }

    }; // wrap with parallel

    var paralleledCdn = parallel(rawCdn, {
      sliceLimit: sliceLimit
    }); // wrap with cache

    var wrappedCdn = enableCache ? compatCache(paralleledCdn, {
      passToCdn: passToCdn,
      cacheLocation: cacheLocation,
      beforeUpload: beforeUpload
    }) : paralleledCdn; // wrap with beforeProcess
    // use beforeUpload properly

    var useableCdn = beforeProcess(wrappedCdn, beforeUpload);
    var img = assetsFiles.img;
    var css = assetsFiles.css;
    var js = assetsFiles.js;
    var font = assetsFiles.font;
    var all = assetsFiles.all;
    var extra = assetsFiles.extra; // preProcess all files to convert computed path to static path

    all.forEach(function (filePath) {
      var fileContent = read(filePath);
      var newContent = preProcess(fileContent, filePath);

      if (fileContent === newContent) {
        return;
      }

      write(filePath)(newContent);
    }); // upload img/font
    // find img/font in css
    // replace css
    // now css ref to img/font with cdn path
    // meanwhile upload chunk files to save time

    log("uploading img + font ...");
    var imgAndFontPairs;

    var _temp3 = _catch(function () {
      return Promise.resolve(useableCdn.upload(img.concat( font))).then(function (_useableCdn$upload) {
        imgAndFontPairs = _useableCdn$upload;
      });
    }, function (e) {
      log('error occurred');
      log(e, 'error');
      _exit = true;
    });

    return Promise.resolve(_temp3 && _temp3.then ? _temp3.then(_temp4) : _temp4(_temp3));
  } catch (e) {
    return Promise.reject(e);
  }
};

var fs = require('fs');

var fse = require('fs-extra');

var path = require('path');

var ref = require('y-upload-utils');
var compatCache = ref.compatCache;
var parallel = ref.parallel;
var beforeProcess = ref.beforeUpload;

var name = 'upload2cdn';
var DEFAULT_SEP = '/';
var FILTER_OUT_DIR = ['.idea', '.vscode', '.gitignore', 'node_modules', '.DS_Store']; // 1. gather html file
// 2. gather production file
// 3. upload all production file
// 4. find the usage of production file in html file
// 5. if found, replace

function resolve() {
  var input = [], len = arguments.length;
  while ( len-- ) input[ len ] = arguments[ len ];

  return path.resolve.apply(path, input);
}

function normalize(input, sep) {
  if ( sep === void 0 ) sep = DEFAULT_SEP;

  var _input = path.normalize(input);

  return _input.split(path.sep).join(sep);
}

function isFilterOutDir(input) {
  return FILTER_OUT_DIR.includes(input);
}

function generateLog(name) {
  return function log(input, mode) {
    if ( mode === void 0 ) mode = 'log';

    console[mode](("[" + name + "]: "), input);
  };
}

var log = generateLog(name);

var read = function (location) { return fs.readFileSync(location, 'utf-8'); };

var write = function (location) { return function (content) { return fs.writeFileSync(location, content); }; };
/**
 * produce RegExp to match local path
 * @param {string} localPath
 * @param {string} fromPath
 * @param {boolean=} loose
 * @return {RegExp}
 */


function generateLocalPathReg(localPath, fromPath, loose) {
  if ( loose === void 0 ) loose = false;

  var relativePath = path.relative(fromPath, localPath);
  var normalRelPath = normalize(relativePath);
  var pathArr = normalRelPath.split(DEFAULT_SEP);
  var char = loose ? '?' : ''; // the file must be matched exactly

  var regStr = "\\.?\\/?" + pathArr.map(function (item) {
    if (item === '..') {
      return ("\\." + char + "\\." + char);
    }

    return item.replace(/\./g, ("\\." + char));
  }).join(("\\" + DEFAULT_SEP));
  return new RegExp(regStr, 'g');
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


function simpleReplace(srcPath, distPath, shouldReplace, loose) {
  if ( distPath === void 0 ) distPath = srcPath;
  if ( shouldReplace === void 0 ) shouldReplace = function () { return true; };
  if ( loose === void 0 ) loose = false;

  var srcFile = read(srcPath);
  var srcDir = path.resolve(srcPath, '..');
  return function savePair(localCdnPair) {
    var ret = localCdnPair.reduce(function (last, ref) {
      var local = ref[0];
      var cdn = ref[1];

      var localPath = normalize(local);
      var cdnPath = cdn;
      var localPathReg = generateLocalPathReg(localPath, normalize(srcDir), loose);
      last = last.replace(localPathReg, function (match) {
        var args = [], len = arguments.length - 1;
        while ( len-- > 0 ) args[ len ] = arguments[ len + 1 ];

        // given [offset - 20, offset + match.length + 20]
        // decide whether to replace the local path with cdn url
        var shift = 20;
        var ref = args.slice(-2);
        var offset = ref[0];
        var str = ref[1];
        var sliceStart = Math.max(0, offset - shift);
        var sliceEnd = Math.min(last.length, offset + match.length + shift);

        if (shouldReplace(str.slice(sliceStart, sliceEnd), localPath)) {
          return cdnPath;
        }

        return match;
      });
      return last;
    }, srcFile);
    fse.ensureFileSync(distPath);
    write(distPath)(ret);
  };
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
    return fs.readdirSync(src).reduce(function (last, file) {
      var filePath = resolve(src, file);

      if (isFile(filePath)) {
        path.extname(file) === ("." + type) && last.push(normalize(filePath));
      } else if (isFilterOutDir(file)) ; else if (isDir(filePath)) {
        last = last.concat(gatherFileIn(filePath)(type));
      }

      return last;
    }, []);
  };
}

function isFile(input) {
  return fs.statSync(input).isFile();
}

function isDir(input) {
  return fs.statSync(input).isDirectory();
}

function isType(type) {
  return function enterFile(file) {
    return isFile(file) && path.extname(file) === '.' + type;
  };
}
/**
 * give the power of playing with cdn url
 * @param {*[]} entries
 * @param {function} cb
 * @returns {[string, string][] | void}
 */


function processCdnUrl(entries, cb) {
  if (typeof cb !== 'function') { log("urlCb is not function", 'error'); }
  return entries.map(function (ref) {
    var local = ref[0];
    var cdn = ref[1];

    // pair[1] should be cdn url
    var useableCdn = cb(cdn);
    if (typeof useableCdn !== 'string') { log("the return result of urlCb is not string", 'error'); }
    return [local, useableCdn];
  });
}

function mapSrcToDist(srcFilePath, srcRoot, distRoot) {
  var ref = [srcFilePath, srcRoot, distRoot].map(function (p) { return normalize(p); });
  var file = ref[0];
  var src = ref[1];
  var dist = ref[2];
  return file.replace(src, dist);
}

var imgTypeArr = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'ico', 'mp3', 'mp4'];
var fontTypeArr = ['woff', 'woff2', 'ttf', 'oft', 'svg', 'eot'];
var ASSET_TYPE = imgTypeArr.concat( fontTypeArr, ['js'], ['css']);
var isCss = isType('css');
var isJs = isType('js');

function isFont(path) {
  return fontTypeArr.some(function (type) { return isType(type)(path); });
}

function isImg(path) {
  return imgTypeArr.some(function (type) { return isType(type)(path); });
}
/**
 * collect everything
 * @param {function(string)} gatherFn
 * @param {string[]} typeList
 * @returns {{all: string[], js: string[], css: string[], img: string[], font: string[]}}
 */


function autoGatherFilesInAsset(gatherFn, typeList) {
  return typeList.reduce(function (last, type) {
    var files = gatherFn(type);
    if (!files.length) { return last; }
    var location = files[0];
    last.all = last.all.concat(files);

    if (isImg(location)) {
      last.img = last.img.concat(files);
    } else if (isCss(location)) {
      last.css = last.css.concat(files);
    } else if (isJs(location)) {
      last.js = last.js.concat(files);
    } else if (isFont(location)) {
      last.font = last.font.concat(files);
    } else {
      last.extra = last.extra.concat(files);
    }

    return last;
  }, {
    all: [],
    img: [],
    js: [],
    font: [],
    css: [],
    extra: []
  });
}

module.exports = {
  upload: upload,
  gatherFileIn: gatherFileIn,
  autoGatherFilesInAsset: autoGatherFilesInAsset
};
//# sourceMappingURL=index.js.map
