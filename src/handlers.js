const get = require('lodash.get')

const THUNDRA_LANG_WRAPPERS = {
    node: `
var thundra;
try {
    thundra = require('@thundra/core')();
} catch (err) {
    try {
        thundra = require('../LOCAL_THUNDRA_DIR/@thundra/core')();
    } catch (err) {
        thundra = require('../NODE_MODULES/@thundra/core')();
    }
} 
const handler = require('../PATH.js');

exports.METHOD = thundra(handler.METHOD);
    `,
    python: `
from thundra.thundra_agent import Thundra
from PATH import METHOD as actual_METHOD

thundra = Thundra()

@thundra
def METHOD(event, context):
  return actual_METHOD(event, context)
      `,
    java8: null,
    dotnetcore: null,
}

const EXTENTION_GENERATORS = {
    node: name => `${name}.js`,
    python: name => `${name}.py`,
}

/**
 * Wrapper name with extension generator
 * @param {Object} func The function to wrap.
 * @return {String} The generated name.
 */
exports.generateWrapperExt = function(func) {
    if (EXTENTION_GENERATORS[func.language]) {
        return EXTENTION_GENERATORS[func.language](func.thundraHandler)
    }
    return null
}

/**
 * Thundra wrapper code generated
 * @param {Object} func The function to wrap.
 * @return {String} The wrapper code.
 */
exports.generateWrapperCode = function(func, config) {
    if (THUNDRA_LANG_WRAPPERS[func.language]) {
        const customNodePath =
            get(func, 'custom.thundra.node_modules_path') ||
            config.node_modules_path ||
            ''
        return THUNDRA_LANG_WRAPPERS[func.language]
            .replace(/PATH/g, func.relativePath)
            .replace(/METHOD/g, func.method)
            .replace(/LOCAL_THUNDRA_DIR/g, func.localThundraDir)
            .replace(/NODE_MODULES/g, customNodePath)
    }
    return null
}

exports.AGENT_LANGS = Object.keys(THUNDRA_LANG_WRAPPERS)
