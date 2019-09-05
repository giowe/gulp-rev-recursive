const path = require("path")
const gutil = require("gulp-util")
const through = require("through2")
const crypto = require("crypto")
const minimatch = require("minimatch")
const mime = require("mime-types")
const typo = require("./typo")
const pkg = require("./package.json")

const fileMap = []
const warnings = []
let verbose
let totalFileHashed = 0
let customVariable = ""
let pattern

function hashFileName(fileWrapper) {
  const { file, name, relative } = fileWrapper
  const valueToHash = name + file.contents + customVariable
  const hash = crypto.createHash("sha256").update(valueToHash).digest("hex").substr(0, 10)
  const nameNoExt = path.parse(file.relative).name

  const hasedName = pattern
    .replace(/{filename}/g, nameNoExt)
    .replace(/{extension}/g, fileWrapper.extension)
    .replace(/{hash}/g, hash)

  fileWrapper.hashedName = hasedName
  fileWrapper.hashedRelative = relative.replace(name, hasedName)
  file.path = path.join(path.dirname(file.path), hasedName)
  totalFileHashed ++

  return hasedName
}

function setReplacedContent(fileWrapper, parentFiles = [fileWrapper]) {
  const indent = typo.repeat("\t", parentFiles.length - 1)
  if (verbose && parentFiles.length === 1) {
    gutil.log("\n")
  }
  if (verbose) {
    gutil.log(gutil.colors.yellow(`${indent}-------------------------Inspecting ${fileWrapper.name}-------------------------`))
  }
  let contents = fileWrapper.file.contents.toString()
  let modified = false

  if (!fileWrapper.hashIgnoringContent) {
    fileMap.forEach(fileWrapperToMatch => {
      if (!fileWrapperToMatch.ignore) {
        Array.from(new Set([fileWrapperToMatch.uniqueId, fileWrapperToMatch.uniqueId.replace(/\//g, "\\"), fileWrapperToMatch.uniqueId.replace(/\\/g, "/")])).forEach(uniqueId => {
          const re = new RegExp(uniqueId, "g")
          const matches = contents.match(re) || []
          if (matches.length) {

            // avoid infinite recursion
            let recursion = false
            for (let i = 0; i < parentFiles.length; i++) {
              const parentFileWrapper = parentFiles[i]
              if (parentFileWrapper.uniqueId === uniqueId) {
                const warning = `Recursion detected in file ${fileWrapperToMatch.name}: ${matches}`
                warnings.push(warning)
                if (verbose) {
                  gutil.log(gutil.colors.red(`${indent}${warning}`))
                }
                recursion = true
                break
              }
            }

            if (!fileWrapperToMatch.hashedName && !recursion) {
              if (verbose) {
                gutil.log(gutil.colors.magenta(`${indent}${typo.fixed(fileWrapperToMatch.name, 35)} => ???`))
              }
              const _parentFiles = parentFiles.slice(0)
              _parentFiles.push(fileWrapperToMatch)
              setReplacedContent(fileWrapperToMatch, _parentFiles)
            }

            if (!recursion) {
              contents = contents.replace(re, path.join(path.dirname(uniqueId), fileWrapperToMatch.hashedName).replace(/\\/g, "/"))
              modified = true
              if (verbose) {
                gutil.log(gutil.colors.white(`${indent}${typo.fixed(uniqueId, 35)} => ${fileWrapperToMatch.hashedName}`))
              }
            }
          }
        })
      }
    })

    if (modified) {
      fileWrapper.file.contents = new Buffer(contents)
      if (verbose) {
        gutil.log(gutil.colors.yellow(`${indent}All mods saved.`))
      }
    } else {
      if (verbose) {
        gutil.log(gutil.colors.yellow(`${indent}Nothing to replace.`))
      }
    }
  } else {
    if (verbose) {
      gutil.log(gutil.colors.yellow(`${indent}Hashing file name but ignoring content replacements.`))
    }
  }

  if (!fileWrapper.ignore) {
    hashFileName(fileWrapper)
    //fileWrapper.hashedName = getHashedFileName(fileWrapper);
    if (verbose) {
      gutil.log(gutil.colors.green(`${indent}${fileWrapper.name} => ${fileWrapper.hashedName}`))
    }
  }
}

function isFirstEqual(arrays){
  const firstElement = arrays[0][0]
  for (let i = 1; i < arrays.length; i++) {
    if (arrays[i][0] !== firstElement) {
      return false
    }
  }
  return true
}

function setUniqueIds() {
  fileMap.map(fileWrapperA => {
    if (!fileWrapperA.uniqueId) {
      const duplicated = {
        indexes: [],
        splittedPaths: []
      }
      fileMap.map((fileWrapperB, index) => {
        if (fileWrapperA.name === fileWrapperB.name) {
          duplicated.indexes.push(index)
          duplicated.splittedPaths.push(fileWrapperB.relative.split(path.sep))
        }
      })

      if (duplicated.indexes.length > 1) {
        while (isFirstEqual(duplicated.splittedPaths)) {
          duplicated.splittedPaths.map(array => array.shift())
        }

        duplicated.indexes.map((fileIndex, i) => {
          fileMap[fileIndex].uniqueId = duplicated.splittedPaths[i].join(path.sep)
        })

      } else {
        fileWrapperA.uniqueId = fileWrapperA.name
      }
    }
  })

  fileMap.sort(function(a, b){
    if (a.uniqueId.length > b.uniqueId.length) {
      return -1
    }
    if (a.uniqueId.length < b.uniqueId.length) {
      return  1
    }
    return 0
  })
}

module.exports = (opt = {}, finalCallback) => {
  opt.ignore = opt.ignore  || ["**/*.html"]
  opt.hashIgnoringContent = opt.hashIgnoringContent || []
  opt.verbose = opt.verbose || verbose
  opt.pattern = opt.pattern || "{filename}_{hash}{extension}"

  verbose = opt.verbose
  customVariable = opt.customVariable
  pattern = opt.pattern

  if (verbose) {
    gutil.log(gutil.colors.yellow("-------------------------Hashing without inspection for audio, image, multipart and video file types-------------------------"))
  }
  function bufferContents(file, enc, cb) {
    // ignore empty files
    if (file.isNull()) {
      cb()
      return
    }

    //generate fileMap ignoring files with opt.ignore extensions
    const extension = path.extname(file.path).substr(1).toLowerCase()
    let type = mime.lookup(extension)
    if (type) {
      type = type.split("/")[0]
    }

    let ignore = false
    for (let i = 0; i < opt.ignore.length; i++) {
      if (minimatch(file.relative, opt.ignore[i])) {
        ignore = true
        break
      }
    }

    let hashIgnoringContent = false
    for (let i = 0; i < opt.hashIgnoringContent.length; i++) {
      if (minimatch(file.relative, opt.hashIgnoringContent[i])) {
        hashIgnoringContent = true
        break
      }
    }

    const fileWrapper = {
      ignore,
      hashIgnoringContent,
      uniqueId: null,
      hashedName: null,
      name: path.basename(file.relative),
      relative: file.relative,
      hashedRelative: null,
      extension: extension ? `.${extension}` : "",
      file
    }


    if (!fileWrapper.ignore && ["audio", "image", "multipart", "video"].indexOf(type) !== -1) {
      hashFileName(fileWrapper)
      if (verbose) {
        gutil.log(gutil.colors.green(`${typo.fixed(fileWrapper.name, 35)} => ${fileWrapper.hashedName}`))
      }
    }

    fileMap.push(fileWrapper)
    cb()
  }

  function endStream() {
    setUniqueIds()

    const files = fileMap.map((fileWrapper) => {
      if (!fileWrapper.hashedName) {
        setReplacedContent(fileWrapper)
      }
      this.push(fileWrapper.file)
      return fileWrapper
    })

    if (warnings.length) {
      gutil.log(gutil.colors.yellow("WARNINGS:"))
      warnings.map(warning => gutil.log("-", gutil.colors.yellow(`${warning}\n`)))
    }

    gutil.log(`${pkg.name}: ${gutil.colors.magenta(totalFileHashed)} files renamed`)

    if (typeof finalCallback === "function") {
      finalCallback(files)
    }
  }

  return through.obj(bufferContents, endStream)
}
