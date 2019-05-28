const fs = require('fs-extra')
const { join } = require('path')
const _ = require('lodash')
const {
    AGENT_LANGS,
    generateWrapperCode,
    generateWrapperExt,
} = require('./handlers')
const { layerInfo, getLayerARN } = require('./layers')
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
            _.get(serverless.service, 'custom.thundra.package_json_path') ||
            options.prefix ||
            process.env.npm_config_prefix ||
            this.serverless.config.servicePath
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
                const funcName = key
                const runtime =
                    func.runtime || this.serverless.service.provider.runtime

                if (_.get(func, 'custom.thundra.disable', false)) {
                    this.warnThundraDisabled(funcName)
                    continue
                }

                if (!_.isString(runtime)) {
                    continue
                }

                const language = AGENT_LANGS.find(lang => runtime.match(lang))
                if (!language) {
                    this.log(
                        `Thundra does not support "${runtime}" at the moment, skipping function ${funcName}`
                    )
                    continue
                }

                const handler = _.isString(func.handler)
                    ? func.handler.split('.')
                    : []
                let relativePath = ''
                let localThundraDir = ''

                func.environment = func.environment || {}
                func.layers = func.layers || []

                if (language == 'python') {
                    let method =
                        _.get(func, 'custom.thundra.mode') ||
                        _.get(
                            this.serverless.service,
                            'custom.thundra.python.mode'
                        ) ||
                        _.get(this.serverless.service, 'custom.thundra.mode') ||
                        'layer'
                    if (method === 'layer') {
                        this.addLayer(func, funcName, 'python')
                        continue
                    } else if (method === 'wrap') {
                        relativePath = handler.slice(0, -1).join('.')
                        relativePath = relativePath.replace(/\//g, '.')
                    } else {
                        this.warnMethodNotSupported(funcName, method)
                        continue
                    }
                } else if (language == 'node') {
                    let method =
                        _.get(func, 'custom.thundra.mode') ||
                        _.get(
                            this.serverless.service,
                            'custom.thundra.node.mode'
                        ) ||
                        _.get(this.serverless.service, 'custom.thundra.mode') ||
                        'layer'
                    if (method === 'layer') {
                        this.addLayer(func, funcName, 'node')
                        continue
                    } else if (method === 'wrap') {
                        relativePath = handler.slice(0, -1).join('.')
                        let lastSlashIndex = relativePath.lastIndexOf('/')
                        if (lastSlashIndex != -1) {
                            localThundraDir =
                                relativePath.slice(0, lastSlashIndex + 1) +
                                'node_modules'
                        }
                    } else {
                        this.warnMethodNotSupported(funcName, method)
                        continue
                    }
                } else if (language == 'java8') {
                    let method =
                        _.get(func, 'custom.thundra.mode') ||
                        _.get(
                            this.serverless.service,
                            'custom.thundra.java.mode'
                        ) ||
                        _.get(this.serverless.service, 'custom.thundra.mode') ||
                        'layer'
                    if (method === 'layer') {
                        if (func.handler.includes('::')) {
                            this.log(
                                'Method specification for handler by "::" is not supported. ' +
                                    'So function ' +
                                    funcName +
                                    ' will not be wrapped!'
                            )
                            continue
                        }
                        this.addLayer(func, funcName, 'java')
                        continue
                    } else if (method === 'wrap') {
                        this.log(
                            'Code wrapping is not supported for java lambda functions. ' +
                                "Please use 'layer' method instead."
                        )
                    } else {
                        this.warnMethodNotSupported(funcName, method)
                        continue
                    }
                }

                funcs.push(
                    Object.assign(func, {
                        method: _.last(handler),
                        funcName,
                        relativePath,
                        language,
                        localThundraDir,
                        thundraHandler: `${funcName}-thundra`,
                    })
                )
            }
        }

        return funcs
    }

    addLayer(func, funcName, lang) {
        if (!lang in layerInfo) {
            this.warnNoLayerInfoExistsForLang(lang)
        }
        const { delegatedHandlerEnvVarName, layerAwsAccountNo } = layerInfo
        const {
            layerName,
            defaultLayerVersion,
            thundraHandlerName,
            needHandlerDelegation,
            customRuntime,
        } = layerInfo[lang]

        let skipHandlerDelegation = false
        const delegatedHandler = func.environment[delegatedHandlerEnvVarName]

        if (needHandlerDelegation) {
            if (func.handler === thundraHandlerName) {
                if (delegatedHandler) {
                    if (delegatedHandler === thundraHandlerName) {
                        this.warnDelegatedHandlerSameWithThundraHandler(
                            funcName
                        )
                        return
                    } else {
                        skipHandlerDelegation = true
                    }
                } else {
                    this.warnNoDelegatedHandler(funcName)
                    return
                }
            } else {
                if (delegatedHandler) {
                    if (delegatedHandler === thundraHandlerName) {
                        this.warnDelegatedHandlerSameWithThundraHandler(
                            funcName
                        )
                    } else {
                        this.warnDelegatedHandlerWillBeOverwritten(funcName)
                    }
                }
            }
        }

        var skipLayerAddition = false
        for (var layer of func.layers) {
            if (layer.includes(layerName)) {
                skipLayerAddition = true
            }
        }

        if (func.layers.length >= 5 && !skipLayerAddition) {
            this.warnLayerLimitReached(funcName, func.layers.length)
            return
        }

        if (needHandlerDelegation) {
            if (!skipHandlerDelegation) {
                func.environment[delegatedHandlerEnvVarName] = func.handler
                func.handler = thundraHandlerName
            } else {
                this.warnHandlerDelegationSkipped(funcName)
            }
        }

        if (customRuntime) {
            func.runtime = 'provided'
        }

        if (!skipLayerAddition) {
            const layerRegion = this.serverless.service.provider.region
            const globalLayerVersion = _.get(
                this.serverless.service,
                'custom.thundra.layer.version'
            )
            const globalLangLayerVersion = _.get(
                this.serverless.service,
                `custom.thundra.${lang}.layer.version`
            )
            const funcLayerVersion = _.get(func, `custom.thundra.layer.version`)
            const layerVersion =
                funcLayerVersion ||
                globalLangLayerVersion ||
                globalLayerVersion ||
                defaultLayerVersion
            const layerARN = getLayerARN(
                layerRegion,
                layerAwsAccountNo,
                layerName,
                layerVersion
            )

            func.layers.push(layerARN)
        } else {
            this.warnLayerAlreadyExists(funcName)
        }
    }

    warnThundraDisabled(funcName) {
        this.log(
            `Thundra integration is disabled for function ${funcName}, skipping.`
        )
    }

    warnMethodNotSupported(funcName, method) {
        this.log(
            `Given method '${method}' for function with the name '${funcName}' is not a valid method ` +
                "please use one of the followings: 'layer', 'wrap'. Skipping..."
        )
    }

    warnLayerAlreadyExists(funcName) {
        this.log(
            'Thundra layer is already added, so no layer will be added to function ' +
                funcName
        )
    }

    warnNoLayerInfoExistsForLang(lang) {
        this.log('No layer information exist for given lang: ' + lang)
    }

    warnHandlerDelegationSkipped(funcName) {
        this.log(
            'Thundra handler was already set and delegated to original handler, ' +
                'so no change will be applied to function ' +
                funcName +
                ' for handler'
        )
    }

    warnDelegatedHandlerWillBeOverwritten(funcName) {
        this.log(
            'Handler to be delegated was already set, ' +
                'but it will be overwriten for function ' +
                funcName
        )
    }

    warnLayerLimitReached(funcName, layerCount) {
        this.log(
            'There are already ' +
                layerCount +
                ' layers as limit is 5, ' +
                'so cannot add Thundra layer to function ' +
                funcName +
                '!'
        )
    }

    warnDelegatedHandlerSameWithThundraHandler(funcName) {
        this.log(
            'Handler to be delegated should be set to original handler, ' +
                'not to the Thundra handler. So function ' +
                funcName +
                ' will not be wrapped!'
        )
    }

    warnNoDelegatedHandler(funcName) {
        this.log(
            'Handler was already set to the Thundra handler ' +
                'but handler to be delegated was not specified. ' +
                'In this case, there is no way to get original handler to be delegated. ' +
                'So function ' +
                funcName +
                ' will not be wrapped!'
        )
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
                `${func.funcName}.handler`,
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
