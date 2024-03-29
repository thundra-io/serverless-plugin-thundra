const fs = require('fs')
const { join } = require('path')
const axios = require('axios')
const rimraf = require('rimraf')
const BbPromise = require('bluebird')

const get = require('lodash.get')
const uniq = require('lodash.uniq')
const isString = require('lodash.isstring')
const last = require('lodash.last')
const isEmpty = require('lodash.isempty')
const set = require('lodash.set')

const {
    AGENT_LANGS,
    generateWrapperCode,
    generateWrapperExt,
} = require('./handlers')
const { layerInfo, getLayerARN, getUserLayerVersion } = require('./layers')
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
            pack = JSON.parse(
                fs.readFileSync(join(this.prefix, 'package.json'), 'utf8')
            )
        } catch (err) {
            this.log(
                'Could not read package.json. Skipping Thundra library validation - please make sure you have it installed!:',
                err
            )
            return
        }
        const { dependencies = [] } = pack
        if (!Object.keys(dependencies).some((dep) => dep === '@thundra/core')) {
            throw new Error(
                "Thundra's Node library must be installed in order to use this plugin!"
            )
        }
    },
    /**
     * Validates the java Thundra's library
     */
    java() {
        this.log(
            'Please ensure that all necessary Thundra Java agents are installed'
        )
    },

    dotnetcore() {
        this.log(
            'Please ensure that all necessary Thundra .NET Core agents are installed'
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
            get(serverless.service, 'custom.thundra.package_json_path') ||
            options.prefix ||
            process.env.npm_config_prefix ||
            this.serverless.config.servicePath
        this.funcs = []
        this.originalServicePath = this.serverless.config.servicePath
        this.commands = {
            Thundra: {
                usage: 'Automatically wraps your function handlers with Thundra.',
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
            'before:package:createDeploymentArtifacts': () =>
                BbPromise.bind(this).then(this.run),
            'before:deploy:function:packageFunction': () =>
                BbPromise.bind(this).then(this.run),
            'before:invoke:local:invoke': () =>
                BbPromise.bind(this).then(this.run),
            'before:offline:start:init': () =>
                BbPromise.bind(this).then(this.run),
            'before:step-functions-offline:start': () =>
                BbPromise.bind(this).then(this.run),
            'after:package:createDeploymentArtifacts': () =>
                BbPromise.bind(this).then(this.cleanup),
            'after:invoke:local:invoke': () =>
                BbPromise.bind(this).then(this.cleanup),
            'thundra:clean:init': () => BbPromise.bind(this).then(this.cleanup),
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
        return BbPromise.fromCallback((cb) => {
            this.config = this.getConfig()
            this.prepareResources().then(() => {
                if (this.checkIfWrap()) {
                    this.log('Wrapping your functions with Thundra...')
                    this.funcs = this.findFuncs()
                    this.libCheck()
                    this.generateHandlers()
                    this.assignHandlers()
                    cb()
                } else {
                    cb()
                }
            })
        })
    }

    /**
     * Checks that all of the required Thundra libraries are installed.
     */
    libCheck() {
        const languages = uniq(this.funcs.map((func) => func.language))
        languages.forEach((lang) => {
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
        const funcs = []
        const slsFunctions = this.serverless.service.functions
        for (const key in slsFunctions) {
            if (slsFunctions.hasOwnProperty(key)) {
                const { service } = this.serverless
                const { provider = {} } = service
                const { layers } = provider
                const func = slsFunctions[key]
                const funcName = key

                if (get(func, 'custom.thundra.disable', false)) {
                    this.warnThundraDisabled(funcName)
                    continue
                }

                /**
                 * Perform runtime checks
                 */
                let runtime = func.runtime || provider.runtime

                if (!isString(runtime)) {
                    continue
                }

                if (runtime.startsWith('java')) {
                    runtime = 'java'
                }

                if (runtime.startsWith('dotnetcore')) {
                    runtime = 'dotnetcore'
                }

                const language = AGENT_LANGS.find((lang) => runtime.match(lang))
                if (!language) {
                    this.log(
                        `Thundra does not support "${runtime}" at the moment, skipping function ${funcName}`
                    )
                    continue
                }

                /**
                 * Split function handler into package, class and function parts
                 */
                const handler = isString(func.handler)
                    ? func.handler.split('.')
                    : []

                let relativePath = ''
                let localThundraDir = ''

                /**
                 * Init function environment and layers parameters
                 * as an empty object if they are not existing
                 */
                func.environment = func.environment || {}
                func.layers = func.layers || []

                if (Array.isArray(layers)) {
                    for (let layer of layers) {
                        if (!func.layers.includes(layer)) {
                            func.layers.push(layer)
                        }
                    }
                }

                if (language === 'python') {
                    const method =
                        get(func, 'custom.thundra.mode') ||
                        get(service, 'custom.thundra.python.mode') ||
                        get(service, 'custom.thundra.mode') ||
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
                } else if (language === 'node') {
                    const method =
                        get(func, 'custom.thundra.mode') ||
                        get(service, 'custom.thundra.node.mode') ||
                        get(service, 'custom.thundra.mode') ||
                        'layer'
                    if (method === 'layer') {
                        this.addLayer(func, funcName, 'node')
                        continue
                    } else if (method === 'wrap') {
                        relativePath = handler.slice(0, -1).join('.')
                        const lastSlashIndex = relativePath.lastIndexOf('/')
                        if (lastSlashIndex !== -1) {
                            localThundraDir =
                                relativePath.slice(0, lastSlashIndex + 1) +
                                'node_modules'
                        }
                    } else {
                        this.warnMethodNotSupported(funcName, method)
                        continue
                    }
                } else if (language === 'java') {
                    const method =
                        get(func, 'custom.thundra.mode') ||
                        get(service, 'custom.thundra.java.mode') ||
                        get(service, 'custom.thundra.mode') ||
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
                } else if (language === 'dotnetcore') {
                    const method =
                        get(func, 'custom.thundra.mode') ||
                        get(service, 'custom.thundra.dotnet.mode') ||
                        get(service, 'custom.thundra.mode') ||
                        'layer'

                    if (method === 'layer') {
                        func.environment['thundra_agent_lambda_handler'] =
                            func.handler

                        const apiKey =
                            get(func, 'custom.thundra.apiKey') ||
                            get(service, 'custom.thundra.apiKey')

                        func.environment['thundra_apiKey'] = apiKey

                        this.addLayer(func, funcName, language)
                        continue
                    } else if (method === 'wrap') {
                        this.log(
                            'Code wrapping is not supported for .NET Core lambda functions. ' +
                                "Please use 'layer' method instead."
                        )
                    } else {
                        this.warnMethodNotSupported(funcName, method)
                        continue
                    }
                }
                funcs.push(
                    Object.assign(func, {
                        method: last(handler),
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
        const service = this.serverless.service
        const providerRuntime = get(service, 'provider.runtime')
        if (!func.runtime) {
            func.runtime = providerRuntime
        }

        if (!(lang in layerInfo)) {
            this.warnNoLayerInfoExistsForLang(lang)
        }
        const { delegatedHandlerEnvVarName, layerAwsAccountNo } = layerInfo
        const {
            layerName,
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
        } else if (lang === 'node') {
            const nodeOptions = func.environment['NODE_OPTIONS']
            func.environment['NODE_OPTIONS'] = nodeOptions
                ? nodeOptions + ' -r @thundra/core/dist/bootstrap/lambda'
                : '-r @thundra/core/dist/bootstrap/lambda'
        }

        var skipLayerAddition = false
        for (var layer of func.layers) {
            if (typeof layer === 'string' && layer.includes(layerName)) {
                skipLayerAddition = true
            }
        }

        if (func.layers.length >= 5 && !skipLayerAddition) {
            this.warnLayerLimitReached(funcName, func.layers.length)
            return
        }

        if (!skipLayerAddition) {
            const userLayerVersion = getUserLayerVersion(func, service, lang)
            if (userLayerVersion) {
                if (
                    typeof userLayerVersion === 'string' &&
                    userLayerVersion.toLowerCase() === 'latest'
                ) {
                    func.layers.push(this.latestLayerArnMap[func.runtime])
                } else if (!this.isValidLayerVersion(userLayerVersion)) {
                    this.warnNoLayerInfoExistsForLangAndVersion(
                        lang,
                        userLayerVersion
                    )
                } else {
                    const layerRegion = service.provider.region
                    const layerARN = getLayerARN(
                        layerRegion,
                        layerAwsAccountNo,
                        layerName,
                        userLayerVersion
                    )

                    func.layers.push(layerARN)
                }
            } else {
                func.layers.push(this.latestLayerArnMap[func.runtime])
            }
        } else {
            this.warnLayerAlreadyExists(funcName)
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
    }

    isValidLayerVersion(layerVersion) {
        try {
            if (layerVersion === 'latest') {
                return true
            }
            return !isNaN(Number(layerVersion))
        } catch (e) {
            return false
        }
    }

    prepareResources() {
        return new Promise((resolve, reject) => {
            this.latestLayerArnMap = {}
            const promiseMap = {}
            const latestLayerPromises = []
            const providerRuntime = get(
                this,
                'serverless.service.provider.runtime'
            )
            const providerRegion = get(
                this,
                'serverless.service.provider.region'
            )
            const functions = get(this, 'serverless.service.functions')

            if (providerRuntime) {
                latestLayerPromises.push(
                    this.getLatestLayerVersion(providerRuntime, providerRegion)
                )
                promiseMap[providerRuntime] = true
            }

            if (functions) {
                for (const key in functions) {
                    if (functions.hasOwnProperty(key)) {
                        const func = functions[key]
                        const funcName = key
                        if (get(func, 'custom.thundra.disable', false)) {
                            this.warnLayerPreparationSkipped(funcName)
                            continue
                        }
                        const runtime = get(func, 'runtime')
                        if (runtime && !promiseMap[runtime]) {
                            latestLayerPromises.push(
                                this.getLatestLayerVersion(
                                    runtime,
                                    providerRegion
                                )
                            )
                            promiseMap[runtime] = true
                        }
                    }
                }
            }
            Promise.all(latestLayerPromises)
                .then((response) => {
                    if (Array.isArray(response)) {
                        for (let obj of response) {
                            const compatibleRuntimes = get(
                                obj,
                                'latest.[0].LatestMatchingVersion.CompatibleRuntimes'
                            )
                            const arn = get(
                                obj,
                                'latest.[0].LatestMatchingVersion.LayerVersionArn'
                            )
                            if (Array.isArray(compatibleRuntimes)) {
                                for (let runtime of compatibleRuntimes) {
                                    this.latestLayerArnMap[runtime] = arn
                                }
                            }
                        }
                    }

                    if (!isEmpty(this.latestLayerArnMap)) {
                        resolve()
                    } else {
                        reject(
                            new Error(
                                `Thundra layer is not supported for the given runtime and region pair`
                            )
                        )
                    }
                })
                .catch((err) => {
                    const rethrownError = new Error(
                        'Error while getting Thundra layers'
                    )
                    rethrownError.stack =
                        rethrownError.stack.split('\n').slice(0, 2).join('\n') +
                        '\n' +
                        err.stack
                    reject(rethrownError)
                })
        })
    }

    getLatestLayerVersion(runtime, region) {
        if (runtime == 'dotnetcore') {
            runtime = 'dotnetcore2.1'
        }
        const url = `https://layers.thundra.io/layers/${region}/${runtime}/latest`
        return new Promise((resolve, reject) => {
            axios
                .get(url)
                .then((response) => {
                    resolve(response.data)
                })
                .catch((error) => {
                    reject(error)
                })
        })
    }

    warnThundraDisabled(funcName) {
        this.log(
            `Thundra integration is disabled for function ${funcName}, skipping.`
        )
    }

    warnLayerPreparationSkipped(funcName) {
        this.log(
            `Thundra layer preparation skipped for disabled function with the name ${funcName}.`
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

    warnNoLayerInfoExistsForLangAndVersion(lang, version) {
        this.log(
            `No layer information exist for given lang: ${lang} given version: ${version}`
        )
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
        this.funcs.forEach((func) => {
            const handlerCode = generateWrapperCode(func, this.config)
            const wrapperFile = generateWrapperExt(func)

            if (handlerCode && wrapperFile) {
                fs.writeFileSync(
                    join(handlersFullDirPath, wrapperFile),
                    handlerCode
                )
            }
        })
    }

    /**
     * Replaces the functions original handlers with Thundra's handlers.
     */
    assignHandlers() {
        this.funcs.forEach((func) => {
            set(
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
        return BbPromise.fromCallback((cb) => {
            this.log("Cleaning up Thundra's handlers")
            rimraf(
                join(this.originalServicePath, this.config.thundraHandlerDir),
                cb
            )
        })
    }
}

module.exports = ServerlessThundraPlugin
