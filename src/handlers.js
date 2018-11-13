const THUNDRA_LANG_WRAPPERS = {
  node: `
    const thundra = require('@thundra/core')();
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
      `
};

const EXTENTION_GENERATORS = {
  node: name => `${name}.js`,
  python: name => `${name}.py`
};

/**
 * Wrapper name with extension generator
 * @param {Object} func The function to wrap.
 * @return {String} The generated name.
 */
exports.generateWrapperExt = function(func) {
  return EXTENTION_GENERATORS[func.language](func.thundraHandler);
};

/**
 * Thundra wrapper code generated
 * @param {Object} func The function to wrap.
 * @return {String} The wrapper code.
 */
exports.generateWrapperCode = function(func) {
  return THUNDRA_LANG_WRAPPERS[func.language]
    .replace(/PATH/g, func.relativePath)
    .replace(/METHOD/g, func.method);
};

module.exports.AGENT_LANGS = Object.keys(THUNDRA_LANG_WRAPPERS);
