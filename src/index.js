const fs = require("fs-extra");
const { join } = require("path");
const { promisify } = require("util");
const _ = require("lodash");
const {
  AGENT_LANGS,
  generateWrapperCode,
  generateWrapperExt
} = require("./handlers");

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

const VALIDATE_LIB_BY_LANG = {
  /**
   * Validates the python Thundra's library
   */
  python() {
    this.log(
      "Please ensure that all necessary Thundra Python agents are installed"
    );
  },
  /**
   * Validates the node Thundra's library
   */
  async node() {
    let pack;
    try {
      pack = await fs.readJson(join(this.prefix, "package.json"));
    } catch (err) {
      this.log(
        "Could not read package.json. Skipping Thundra library validation - please make sure you have it installed!"
      );
      return;
    }
    const { dependencies = [] } = pack;
    if (!Object.keys(dependencies).some(dep => dep === "@thundra/core")) {
      throw new Error(
        "Thundra's Node library must be installed in order to use this plugin!"
      );
    }
  }
};
/**
 * Thundra's serverless plugin.
 */
class ServerlessThundraPlugin {
  /**
   * The constructor for the plugin.
   * @param {Object} serverless
   * @param {Object} options options.
   */
  constructor(serverless = {}, options) {
    this.serverless = serverless;
    this.prefix =
      options.prefix ||
      this.serverless.config.servicePath ||
      process.env.npm_config_prefix;
    this.funcs = [];
    this.originalServicePath = this.serverless.config.servicePath;
    this.commands = {
      Thundra: {
        usage: "Automatically wraps your function handlers with Thundra.",
        lifecycleEvents: ["run", "clean"],
        commands: {
          clean: {
            usage: "Cleans up extra Thundra files if necessary",
            lifecycleEvents: ["init"]
          }
        }
      }
    };

    this.hooks = {
      "before:package:createDeploymentArtifacts": this.run.bind(this),
      "before:deploy:function:packageFunction": this.run.bind(this),
      "before:invoke:local:invoke": this.run.bind(this),
      "before:offline:start:init": this.run.bind(this),
      "before:step-functions-offline:start": this.run.bind(this),
      "after:package:createDeploymentArtifacts": this.cleanup.bind(this),
      "after:invoke:local:invoke": this.cleanup.bind(this),
      "thundra:clean:init": this.cleanup.bind(this)
    };
  }

  /**
   * logs a message to the serverless console.
   * @param {string} format The format of the message.
   * @param {Array} args Additional arguments.
   */
  log(format, ...args) {
    this.serverless.cli.log(`[serverless-plugin-thundra] ${format}`, ...args);
  }

  /**
   * Wraps function handlers with Thundra
   */
  async run() {
    this.config = this.getConfig();
    if (this.checkIfWrap()) {
      this.log("Wrapping your functions with Thundra...");
      this.funcs = this.findFuncs();
      await this.libCheck();
      await this.generateHandlers();
      this.assignHandlers();
    } else {
      return;
    }
  }

  /**
   * Checks that all of the required Thundra libraries are installed.
   */
  async libCheck() {
    const languages = _.uniq(this.funcs.map(func => func.language));
    await Promise.all(
      languages.map(async lang => {
        await VALIDATE_LIB_BY_LANG[lang].bind(this)();
      })
    );
  }

  /**
   * Checks if a Thundra API key has been provided in .yml file
   * @return {Boolean} Prescence of Thundra API Key.
   */
  checkIfWrap() {
    if (this.config.disable) {
      this.log("Automatic Wrapping is dsabled.");
      return false;
    }
    if (!this.config.apiKey) {
      this.log("Thundra API Key not provided. Function wrapping skipped");
      return false;
    }
    return true;
  }

  /**
   * Finds all the functions the plugin should wrap with Thundra.
   * @return {Array} The functions to wrap.
   */
  findFuncs() {
    return Object.entries(this.serverless.service.functions).reduce(
      (result, pair) => {
        const [key, func] = pair;
        const runtime =
          func.runtime || this.serverless.service.provider.runtime;

        if (!_.isString(runtime)) {
          return result;
        }

        const language = AGENT_LANGS.find(lang => runtime.match(lang));
        if (!language) {
          this.log(
            `Thundra does not support "${runtime}" at the moment, skipping function ${key}`
          );
          return result;
        }

        const handler = _.isString(func.handler) ? func.handler.split(".") : [];
        const relativePath = handler.slice(0, -1).join(".");
        if (func.disableThundra) {
          this.log(
            `Automatic wrapping is disabled for function ${key}, skipping.`
          );
        } else {
          result.push(
            Object.assign(func, {
              method: _.last(handler),
              key,
              relativePath,
              language,
              thundraHandler: `${key}-thundra`
            })
          );
        }
        return result;
      },
      []
    );
  }

  /**
   * Generates the Thundra handlers and writes them to the FS.
   */
  async generateHandlers() {
    const handlersFullDirPath = join(
      this.originalServicePath,
      this.config.thundraHandlerDir
    );
    try {
      await mkdir(handlersFullDirPath);
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw err;
      }
    }
    await Promise.all(
      this.funcs.map(async func => {
        const handlerCode = generateWrapperCode(func, this.config);
        await writeFile(
          join(handlersFullDirPath, generateWrapperExt(func)),
          handlerCode
        );
      })
    );
  }

  /**
   * Replaces the functions original handlers with Thundra's handlers.
   */
  assignHandlers() {
    this.funcs.forEach(func => {
      _.set(
        this.serverless.service.functions,
        `${func.key}.handler`,
        join(
          this.config.thundraHandlerDir,
          `${func.thundraHandler}.${func.method}`
        )
      );
    });
  }

  /**
   * Gets the plugin config.
   * @returns {Object} The config object
   */
  getConfig() {
    return Object.assign(
      {
        thundraHandlerDir: "thundra_handlers"
      },
      (this.serverless.service.custom || {}).thundra || {}
    );
  }

  /**
   * Cleaning Thundra's handlers
   */
  cleanup() {
    this.log("Cleaning up Thundra's handlers");
    fs.removeSync(
      join(this.originalServicePath, this.config.thundraHandlerDir)
    );
  }
}

module.exports = ServerlessThundraPlugin;
