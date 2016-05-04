"use strict";

let fs = require('fs-extra');
let path = require('path');
let ts = require('typescript');
let _ = require('lodash');
let Concat = require('concat-with-sourcemaps');
let config = require('../config.json');

const PLUGIN_TEMPLATE_PATH = path.join(__dirname, '..', config.templates.plugin);

/**
 * Compiles TypeScript files into a single file
 * @param {string} visualPath - root path of the visual project
 * @returns {Promise}
 */
function compileTypescript(files, compilerOptions) {
    return new Promise((resolve, reject) => {
        let convertedOptions = ts.convertCompilerOptionsFromJson(compilerOptions);
        
        //check for configuration errors
        if(convertedOptions.errors && convertedOptions.errors.length > 0) {
            return reject(convertedOptions.errors.map(err => `(${err.code}) ${err.messageText}`));
        }
        
        //check that options were successfully created
        if (!convertedOptions.options) {
            return reject(["Unknown tsconfig error."]);
        }
        let program = ts.createProgram(files, convertedOptions.options);

        //check for compilation errors
        let allDiagnostics = ts.getPreEmitDiagnostics(program);
        if(allDiagnostics && allDiagnostics.length > 0) {
            return reject(allDiagnostics.map(diagnostic => {
                let results = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);

                return {
                    filename: diagnostic.file.fileName,
                    line: results.line + 1,
                    column: results.character + 1,
                    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
                    type: 'typescript'
                };                
            }));
        }
        
        //create files (source and maps)
        program.emit();
        resolve();
    });
}

function createPlugin(visualPackage, pluginName) {
    let visualConfig = visualPackage.config;
    let pluginOptions = {
        pluginName: pluginName,
        visualGuid: visualConfig.visual.guid,
        visualClass: visualConfig.visual.visualClassName,
        visualDisplayName: visualConfig.visual.displayName,
        visualVersion: visualConfig.visual.version,
        apiVersion: visualConfig.apiVersion
    };    
    let pluginTemplate = fs.readFileSync(PLUGIN_TEMPLATE_PATH);
    let pluginTs = _.template(pluginTemplate)(pluginOptions);
    let pluginDropPath = visualPackage.buildPath(config.build.tempFolder, 'visualPlugin.ts');
    fs.writeFileSync(pluginDropPath, pluginTs);
    return pluginDropPath;
}

function copyFileWithNamespace(source, target, guid) {
    if(path.extname(source).toLowerCase() === '.ts') {
        let fileContents = fs.readFileSync(source).toString();
        let re = new RegExp("module powerbi.extensibility.visual((.|\\n)*?)\s*{", "g");
        let output = fileContents.replace(re, "module powerbi.extensibility.visual." + guid + "$1 {");
        fs.writeFileSync(target, output);
    } else {
        fs.copySync(source, target);
    }
}

function createNamespacedCopy(visualPackage, files) {
    let guid = visualPackage.config.visual.guid;
    return files.map(file => {
        let filePath = visualPackage.buildPath(file);
        let targetPath = visualPackage.buildPath(config.build.tempFolder, file);
        copyFileWithNamespace(filePath, targetPath, guid);
        return targetPath;
    });
}


class TypescriptCompiler {
    /**
     * Builds typescript of a visual package
     * @param {VisualPackage} package - An instance of a visual package
     * @returns {Promise}
     */
    static build(visualPackage, pluginName) {
        let visualConfig = visualPackage.config;
        return new Promise((resolve, reject) => {
            //TODO: visual specific TS validation
            let tsconfig = require(visualPackage.buildPath('tsconfig.json'));
            let pluginPath = createPlugin(visualPackage, pluginName);
            let tmpFiles = createNamespacedCopy(visualPackage, tsconfig.files);
            tmpFiles.push(pluginPath);
            tsconfig.compilerOptions.out = visualPackage.buildPath(config.build.dropFolder, config.build.js);
            compileTypescript(tmpFiles, tsconfig.compilerOptions).then(resolve).catch(reject);
        });
    }
}

module.exports = TypescriptCompiler;