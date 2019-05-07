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
    /**
     * Validates the java Thundra's library
     */
    java8() {
        this.log(
            'Please ensure that all necessary Thundra Java agents are installed'
        )
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
            this.log('Automatic Wrapping is disabled.')
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
                } else if (language == 'node') {
                    relativePath = handler.slice(0, -1).join('.')
                    let lastSlashIndex = relativePath.lastIndexOf('/')
                    if (lastSlashIndex != -1) {
                        localThundraDir =
                            relativePath.slice(0, lastSlashIndex + 1) +
                            'node_modules'
                    }
                } else if (language == 'java8') {
                    func.environment = func.environment || {}
                    func.layers = func.layers || []

                    const thundraHandlerName =
                        'io.thundra.agent.lambda.core.handler.ThundraLambdaHandler'
                    const delegatedHandlerEnvVarName =
                        'thundra_agent_lambda_handler'

                    const delegatedHandler =
                        func.environment[delegatedHandlerEnvVarName]
                    var skipHandlerDelegation = false
                    if (func.handler.includes('::')) {
                        this.log(
                            'Method specification for handler by "::" is not supported. ' +
                                'So function ' +
                                key +
                                ' will not be wrapped!'
                        )
                        continue
                    } else if (func.handler === thundraHandlerName) {
                        if (delegatedHandler) {
                            if (delegatedHandler === thundraHandlerName) {
                                this.log(
                                    'Handler to be delegated should be set to original handler, ' +
                                        'not to the Thundra handler. So function ' +
                                        key +
                                        ' will not be wrapped!'
                                )
                                continue
                            } else {
                                skipHandlerDelegation = true
                            }
                        } else {
                            this.log(
                                'Handler was already set to the Thundra handler ' +
                                    'but handler to be delegated was not specified. ' +
                                    'In this case, there is no way to get original handler to be delegated. ' +
                                    'So function ' +
                                    key +
                                    ' will not be wrapped!'
                            )
                            continue
                        }
                    } else {
                        if (delegatedHandler) {
                            if (delegatedHandler === thundraHandlerName) {
                                this.log(
                                    'Handler to be delegated should be set to original handler, ' +
                                        'not to the Thundra handler. Misconfiguration will be corrected ' +
                                        'for function ' +
                                        key
                                )
                            } else {
                                this.log(
                                    'Handler to be delegated was already set, ' +
                                        'but it will be overriten for function ' +
                                        key
                                )
                            }
                        }
                    }

                    var skipLayerAddition = false
                    for (var layer of func.layers) {
                        if (layer.includes('thundra-lambda-java-layer')) {
                            skipLayerAddition = true
                        }
                    }

                    if (func.layers.length >= 5 && !skipLayerAddition) {
                        this.log(
                            'There are already ' +
                                func.layers.length +
                                ' layers as limit is 5, ' +
                                'so cannot add Thundra layer to function ' +
                                key +
                                '!'
                        )
                        continue
                    }

                    if (!skipHandlerDelegation) {
                        func.environment[delegatedHandlerEnvVarName] =
                            func.handler
                        func.handler = thundraHandlerName
                    } else {
                        this.log(
                            'Thundra handler was already set and delegated to original handler, ' +
                                'so no change will be applied to function ' +
                                key +
                                ' for handler'
                        )
                    }

                    if (!skipLayerAddition) {
                        const layerVersionPropName =
                            'custom.thundra.java.layer.version'
                        const layerRegion = this.serverless.service.provider
                            .region
                        const layerAwsAccountNo = 269863060030
                        const layerName = 'thundra-lambda-java-layer'
                        const defaultLayerVersion = '14'
                        const globalLayerVersion = _.get(
                            this.serverless.service,
                            layerVersionPropName
                        )
                        const funcLayerVersion = _.get(
                            func,
                            layerVersionPropName
                        )
                        const layerVersion = funcLayerVersion
                            ? funcLayerVersion
                            : globalLayerVersion
                            ? globalLayerVersion
                            : defaultLayerVersion
                        const layerArn =
                            'arn:aws:lambda:' +
                            layerRegion +
                            ':' +
                            layerAwsAccountNo +
                            ':' +
                            'layer:' +
                            layerName +
                            ':' +
                            layerVersion
                        func.layers.push(layerArn)
                    } else {
                        this.log(
                            'Thundra layer is already added, so no layer will be added to function ' +
                                key
                        )
                    }

                    continue
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
