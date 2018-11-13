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
    this.log("Please ensure that Thundra's Python agent is installed");
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
        "Could not read package.json. Please ensure that Thundra's Node.js agent is installed."
      );
      return;
    }
    const { dependencies = [] } = pack;
    if (!Object.keys(dependencies).some(dep => dep === "@thundra/core")) {
      throw new Error(
        "Thundra's Node.js library must be installed in order to use this plugin!"
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
    this.doWrap = this.checkAPIKey;
    if (this.doWrap) {
      this.log("Wrapping your functions with Thundra...");
      this.funcs = this.findFuncs();
      await this.libCheck();
      await this.generateHandlers();
      this.assignHandlers();
      this.log("Your functions are now wrapped. Begin Flight!");
    } else {
      return;
    }
  }

  /**
   * Checks if a Thundra API key has been provided in .yml file
   * @return {Boolean} Prescence of Thundra API Key.
   */
  checkAPIKey() {
    if (!this.config.thundraApiKey) {
      this.log(
        "Thundra API Key not provided as enviroment variable in serverless file. Function wrapping skipped"
      );
      return false;
    } else {
      return true;
    }
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
        const handlerMethod = handler[1];

        var handlerFile = join(handler[0], ".py")
          .split("/")
          .join("");
        handlerFile = join(this.prefix, handlerFile);

        result.push(
          Object.assign(func, {
            method: _.last(handler),
            key,
            relativePath,
            language,
            thundraHandler: `${key}-thundra`,
            handlerFile,
            handlerMethod,
            pyMethodDef: null
          })
        );
        return result;
      },
      []
    );
  }

  async getPyParams() {
    await Promise.all(
      this.funcs.map(async func => {
        this.log(`Language Seen: ${func.language}`);

        try {
          let contents = fs.readFileSync(func.handlerFile, "utf8");
          if (contents.includes(func.handlerMethod)) {
            let method = contents.slice(
              contents.indexOf(func.handlerMethod),
              contents.indexOf(":")
            );
            let params = method.slice(method.indexOf("("));
            this.log(`PARAMS SEENS ${params}`);
            func.pyMethodDef = params;
            this.log(`PYNUM IN METHOD: ${func.pyMethodDef}`);
          }
        } catch (err) {
          this.log(`Could not read handler file: ${err}`);
        }
      })
    );
  }

  /**
   * Ensure all Thundra agent libraries present
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
   * Gnerating handler files.
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
   * Substitutes original handlers with Thundra's handlers.
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
   * Gets config info.
   * @returns {Object} The config object
   */
  getConfig() {
    return Object.assign(
      {
        thundraHandlerDir: "thundra_handlers"
      },
      this.serverless.service.custom || {} || {}
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
