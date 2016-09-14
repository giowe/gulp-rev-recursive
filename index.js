"use strict";

const path    = require('path');
const gutil   = require('gulp-util');
const through = require('through2');
const crypto  = require('crypto');
const mime    = require('mime-types');
const typo    = require('./typo');
const pkg     = require('./package.json');

const fileMap = [];
const warnings = [];
let   verbose ;
let   totalFileHashed = 0;

function hashFileName(fileWrapper) {
  const file = fileWrapper.file;
  const valueToHash = fileWrapper.name + file.contents;
  const hash = crypto.createHash('sha256').update(valueToHash).digest('hex').substr(0,10);
  const nameNoExt = path.parse(file.relative).name;
  const hasedName = `${nameNoExt}_${(hash)}.${fileWrapper.extension}`;
  fileWrapper.hashedName = hasedName;
  file.path = path.join(path.dirname(file.path), hasedName);
  totalFileHashed ++;

  return hasedName;
}

function setReplacedContent(fileWrapper, parentFiles) {
  parentFiles = parentFiles || [fileWrapper];
  const indent = typo.repeat('\t', parentFiles.length -1);
  if (verbose && parentFiles.length === 1) gutil.log('\n');
  if (verbose) gutil.log(gutil.colors.yellow(`${indent}-------------------------Inspecting ${fileWrapper.name}-------------------------`));
  let contents = fileWrapper.file.contents.toString();
  let modified = false;
  fileMap.map(fileWrapperToMatch => {
    if (!fileWrapperToMatch.ignore) {
      const re = new RegExp(fileWrapperToMatch.uniqueId.replace(/\./g, '\\.'), 'g');
      const matches = contents.match(re) || [];
      if (matches.length) {

        // evitare ricorsioni
        let recursion = false;
        for (let i = 0; i < parentFiles.length; i++) {
          const parentFileWrapper = parentFiles[i];
          if (parentFileWrapper.uniqueId === fileWrapperToMatch.uniqueId) {
            const warning = `Recursion detected in file ${fileWrapperToMatch.name}: ${matches}`;
            warnings.push(warning);
            if (verbose) gutil.log(gutil.colors.red(`${indent}${warning}`));
            recursion = true;
            break;
          }
        }

        if (!fileWrapperToMatch.hashedName && !recursion) {
          if (verbose) gutil.log(gutil.colors.magenta(`${indent}${typo.fixed(fileWrapperToMatch.name, 35)} => ???`));
          const _parentFiles = parentFiles.slice(0);
          _parentFiles.push(fileWrapperToMatch);
          setReplacedContent(fileWrapperToMatch, _parentFiles);
        }

        if (!recursion) {
          contents = contents.replace(re, path.join(path.dirname(fileWrapperToMatch.uniqueId), fileWrapperToMatch.hashedName));
          modified = true;
          if (verbose) gutil.log(gutil.colors.white(`${indent}${typo.fixed(fileWrapperToMatch.uniqueId, 35)} => ${fileWrapperToMatch.hashedName}`));
        }
      }
    }
  });

  if (modified) {
    fileWrapper.file.contents = new Buffer(contents);
    if (verbose) gutil.log(gutil.colors.yellow(`${indent}All mods saved.`));
  } else {
    if (verbose) gutil.log(gutil.colors.yellow(`${indent}Nothing to replace.`));
  }

  if (!fileWrapper.ignore) {
    hashFileName(fileWrapper);
    //fileWrapper.hashedName = getHashedFileName(fileWrapper);
    if (verbose) gutil.log(gutil.colors.green(`${indent}${fileWrapper.name} => ${fileWrapper.hashedName}`));
  }
}

function isFirstEqual(arrays){
  const firstElement = arrays[0][0];
  for (let i = 1; i < arrays.length; i++) {
    if (arrays[i][0] !== firstElement) return false;
  }
  return true;
}

function setUniqueIds() {
  fileMap.map(fileWrapperA => {
    if (!fileWrapperA.uniqueId) {
      const duplicated = {
        indexes: [],
        splittedPaths: []
      };
      fileMap.map((fileWrapperB, index) => {
        if (fileWrapperA.name === fileWrapperB.name) {
          duplicated.indexes.push(index);
          duplicated.splittedPaths.push(fileWrapperB.relative.split(path.sep))
        }
      });

      if(duplicated.indexes.length > 1) {
        while (isFirstEqual(duplicated.splittedPaths)) {
          duplicated.splittedPaths.map(array => array.shift());
        }

        duplicated.indexes.map((fileIndex, i) => {
          fileMap[fileIndex].uniqueId = duplicated.splittedPaths[i].join(path.sep);
        });

      } else {
        fileWrapperA.uniqueId = fileWrapperA.name;
      }
    }
  });

  fileMap.sort(function(a, b){
    if (a.uniqueId.length > b.uniqueId.length) return -1;
    if (a.uniqueId.length < b.uniqueId.length) return  1;
    return 0;
  });
}

module.exports = function(opt) {
  opt = opt || {};
  opt.ignore  = opt.ignore  || ['html'];
  opt.verbose = opt.verbose || verbose;

  verbose = opt.verbose;

  if (verbose) gutil.log(gutil.colors.yellow(`-------------------------Hashing without inspection for audio, image, multipart and video file types-------------------------`));
  function bufferContents(file, enc, cb) {
    // ignore empty files
    if (file.isNull()) {
      cb();
      return;
    }

    //generate fileMap ignoring files with opt.ignore extensions
    const extension = path.extname(file.path).substr(1).toLowerCase();
    const type = mime.lookup(extension).split('/')[0];
    const fileWrapper = {
      ignore: opt.ignore.indexOf(extension) !== -1,
      uniqueId: null,
      hashedName: null,
      name: path.basename(file.relative),
      relative: file.relative,
      extension: extension,
      file: file
    };


    if (!fileWrapper.ignore && ['audio', 'image', 'multipart', 'video'].indexOf(type) !== -1) {
      hashFileName(fileWrapper);
      if (verbose) gutil.log(gutil.colors.green(`${typo.fixed(fileWrapper.name, 35)} => ${fileWrapper.hashedName}`));
    }

    fileMap.push(fileWrapper);

    cb();
  }

  function endStream(cb) {
    setUniqueIds();

    fileMap.map((fileWrapper) => {
      if (!fileWrapper.hashedName) setReplacedContent(fileWrapper);
      this.push(fileWrapper.file);
    });

    if (warnings.length) {
      gutil.log(gutil.colors.yellow('WARNINGS:'));
      warnings.map(warning => gutil.log('-',gutil.colors.yellow(`${warning}\n`)));
    }

    gutil.log(`${pkg.name}: ${gutil.colors.magenta(totalFileHashed)} files renamed`);
    cb();
  }

  return through.obj(bufferContents, endStream);
};
