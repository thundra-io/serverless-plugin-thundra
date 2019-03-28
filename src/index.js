const fs = require('fs-extra')
const { join } = require('path')
const _ = require('lodash')
const {
    AGENT_LANGS,
    generateWrapperCode,
    generateWrapperExt,
} = require('./handlers')

const VALIDATE_LIB_BY_LANG = {
    /**
     * Validates the python Thundra's library
     */
    python() {
        this.log(
            'Please ensure that all necessary Thundra Python agents are installed'
        )
    },
    /**
     * Validates the node Thundra's library
     */
    node() {
        let pack
        try {
            pack = fs.readJsonSync(join(this.prefix, 'package.json'))
        } catch (err) {
            this.log(
                'Could not read package.json. Skipping Thundra library validation - please make sure you have it installed!'
            )
            return
        }
        const { dependencies = [] } = pack
        if (!Object.keys(dependencies).some(dep => dep === '@thundra/core')) {
            throw new Error(
                "Thundra's Node library must be installed in order to use this plugin!"
            )
        }
    },
}
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
        this.serverless = serverless
        this.prefix =
            options.prefix ||
            this.serverless.config.servicePath ||
            process.env.npm_config_prefix
        this.funcs = []
        this.originalServicePath = this.serverless.config.servicePath
        this.commands = {
            Thundra: {
                usage:
                    'Automatically wraps your function handlers with Thundra.',
                lifecycleEvents: ['run', 'clean'],
                commands: {
                    clean: {
                        usage: 'Cleans up extra Thundra files if necessary',
                        lifecycleEvents: ['init'],
                    },
                },
            },
        }

        this.hooks = {
            'before:package:createDeploymentArtifacts': this.run.bind(this),
            'before:deploy:function:packageFunction': this.run.bind(this),
            'before:invoke:local:invoke': this.run.bind(this),
            'before:offline:start:init': this.run.bind(this),
            'before:step-functions-offline:start': this.run.bind(this),
            'after:package:createDeploymentArtifacts': this.cleanup.bind(this),
            'after:invoke:local:invoke': this.cleanup.bind(this),
            'thundra:clean:init': this.cleanup.bind(this),
        }
    }

    /**
     * logs a message to the serverless console.
     * @param {string} format The format of the message.
     * @param {Array} args Additional arguments.
     */
    log(format, ...args) {
        this.serverless.cli.log(
            `[serverless-plugin-thundra] ${format}`,
            ...args
        )
    }

    /**
     * Wraps function handlers with Thundra
     */
    run() {
        this.config = this.getConfig()
        if (this.checkIfWrap()) {
            this.log('Wrapping your functions with Thundra...')
            this.funcs = this.findFuncs()
            this.libCheck()
            this.generateHandlers()
            this.assignHandlers()
        } else {
            return
        }
    }

    /**
     * Checks that all of the required Thundra libraries are installed.
     */
    libCheck() {
        const languages = _.uniq(this.funcs.map(func => func.language))
        languages.forEach(lang => {
            VALIDATE_LIB_BY_LANG[lang].bind(this)()
        })
    }

    /**
     * Checks if thundra plugin is disabled .yml file
     * @return {Boolean} Whether Thundra pluging is disabled
     */
    checkIfWrap() {
        if (this.config.disable) {
            this.log('Automatic Wrapping is dsabled.')
            return false
        }
        return true
    }

    /**
     * Finds all the functions the plugin should wrap with Thundra.
     * @return {Array} The functions to wrap.
     */
    findFuncs() {
        let funcs = []
        const slsFunctions = this.serverless.service.functions
        for (const key in slsFunctions) {
            if (slsFunctions.hasOwnProperty(key)) {
                const func = slsFunctions[key]
                const runtime =
                    func.runtime || this.serverless.service.provider.runtime

                if (!_.isString(runtime)) {
                    continue
                }

                const language = AGENT_LANGS.find(lang => runtime.match(lang))
                if (!language) {
                    this.log(
                        `Thundra does not support "${runtime}" at the moment, skipping function ${key}`
                    )
                    continue
                }

                const handler = _.isString(func.handler)
                    ? func.handler.split('.')
                    : []
                let relativePath = ''
                let localThundraDir = ''
                if (language == 'python') {
                    relativePath = handler.slice(0, -1).join('.')
                    relativePath = relativePath.replace(/\//g, '.')
                } else {
                    relativePath = handler.slice(0, -1).join('.')
                    let lastSlashIndex = relativePath.lastIndexOf('/')
                    if (lastSlashIndex != -1) {
                        localThundraDir =
                            relativePath.slice(0, lastSlashIndex + 1) +
                            'node_modules'
                    }
                }

                if (_.get(func, 'custom.thundra.disable', false)) {
                    this.log(
                        `Automatic wrapping is disabled for function ${key}, skipping.`
                    )
                    continue
                } else {
                    funcs.push(
                        Object.assign(func, {
                            method: _.last(handler),
                            key,
                            relativePath,
                            language,
                            localThundraDir,
                            thundraHandler: `${key}-thundra`,
                        })
                    )
                }
            }
        }

        return funcs
    }

    /**
     * Generates the Thundra handlers and writes them to the FS.
     */
    generateHandlers() {
        const handlersFullDirPath = join(
            this.originalServicePath,
            this.config.thundraHandlerDir
        )
        try {
            fs.mkdirSync(handlersFullDirPath)
        } catch (err) {
            if (err.code !== 'EEXIST') {
                throw err
            }
        }
        this.funcs.forEach(func => {
            const handlerCode = generateWrapperCode(func, this.config)
            fs.writeFileSync(
                join(handlersFullDirPath, generateWrapperExt(func)),
                handlerCode
            )
        })
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
            )
        })
    }

    /**
     * Gets the plugin config.
     * @returns {Object} The config object
     */
    getConfig() {
        return Object.assign(
            {
                thundraHandlerDir: 'thundra_handlers',
            },
            (this.serverless.service.custom || {}).thundra || {}
        )
    }

    /**
     * Cleaning Thundra's handlers
     */
    cleanup() {
        this.log("Cleaning up Thundra's handlers")
        fs.removeSync(
            join(this.originalServicePath, this.config.thundraHandlerDir)
        )
    }
}

module.exports = ServerlessThundraPlugin
