const _ = require('lodash')

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
    return EXTENTION_GENERATORS[func.language](func.thundraHandler)
}

/**
 * Thundra wrapper code generated
 * @param {Object} func The function to wrap.
 * @return {String} The wrapper code.
 */
exports.generateWrapperCode = function(func, config) {
    let customNodePath =
        _.get(func, 'custom.thundra.node_modules_path') ||
        config.node_modules_path ||
        ''
    return THUNDRA_LANG_WRAPPERS[func.language]
        .replace(/PATH/g, func.relativePath)
        .replace(/METHOD/g, func.method)
        .replace(/LOCAL_THUNDRA_DIR/g, func.localThundraDir)
        .replace(/NODE_MODULES/g, customNodePath)
}

module.exports.AGENT_LANGS = Object.keys(THUNDRA_LANG_WRAPPERS)
