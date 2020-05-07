const get = require('lodash.get')

exports.layerInfo = {
    java: getJavaLayerProps,
    python: {
        layerName: 'thundra-lambda-python-layer',
        defaultLayerVersion: '20',
        thundraHandlerName: 'thundra.handler.wrapper',
        needHandlerDelegation: true,
    },
    node: getNodeLayerProps,
    layerAwsAccountNo: 269863060030,
    delegatedHandlerEnvVarName: 'thundra_agent_lambda_handler',
}

function getNodeLayerProps(func, service, userLayerVersion) {
    const optsWithCR = {
        layerName: 'thundra-lambda-node-layer',
        defaultLayerVersion: '57',
        needHandlerDelegation: false,
        customRuntime: true,
    }

    const optsWithoutCR = {
        layerName: 'thundra-lambda-node-layer',
        defaultLayerVersion: '57',
        needHandlerDelegation: true,
        thundraHandlerName:
            'thundra_handler.wrapper',
    }

    const optsMinified = {
        layerName: 'thundra-lambda-node-layer-minified',
        defaultLayerVersion: '57',
        needHandlerDelegation: true,
        thundraHandlerName:
            'thundra_handler.wrapper',
    }

    try {
        const withoutCRVersionThreshold = 32
        const minifiedLayerThreshold = 57

        const eligibleForWithoutCR =
            userLayerVersion === undefined ||
            userLayerVersion === 'latest' ||
            Number(userLayerVersion) > withoutCRVersionThreshold

        const useCustomRuntime =
            get(func, 'custom.thundra.useCustomRuntime') ||
            get(service, 'custom.thundra.useCustomRuntime') ||
            false

        const versionStr = func.runtime.split('nodejs')[1].split('.')[0]
        const version = Number(versionStr)

        if (!eligibleForWithoutCR || useCustomRuntime || version <= 8) {
            return optsWithCR
        }

        const eligibleForMinified = 
            userLayerVersion === undefined ||
            userLayerVersion === 'latest' || 
            Number(userLayerVersion) >= minifiedLayerThreshold

        return eligibleForMinified ? optsMinified : optsWithoutCR
    } catch (e) {
        return optsWithCR
    }
}

function getJavaLayerProps(func, service, userLayerVersion) {
    const optsWithoutCR = {
        layerName: 'thundra-lambda-java-layer',
        defaultLayerVersion: '42',
        thundraHandlerName:
            'io.thundra.agent.lambda.core.handler.ThundraLambdaHandler',
        needHandlerDelegation: true,
    }

    const optsWithCR = {
        layerName: 'thundra-lambda-java-layer',
        defaultLayerVersion: '42',
        customRuntime: true,
        needHandlerDelegation: false,
    }

    const useCustomRuntime =
        get(func, 'custom.thundra.useCustomRuntime') ||
        get(service, 'custom.thundra.useCustomRuntime') ||
        false

    if (useCustomRuntime) {
        return optsWithCR
    }

    return useCustomRuntime ? optsWithCR : optsWithoutCR
}

exports.getLayerARN = (region, accountNo, name, version) => {
    return (
        'arn:aws:lambda:' +
        region +
        ':' +
        accountNo +
        ':' +
        'layer:' +
        name +
        ':' +
        version
    )
}

exports.getUserLayerVersion = (func, service, lang) => {
    const globalLayerVersion = get(service, 'custom.thundra.layer.version')
    const globalLangLayerVersion = get(
        service,
        `custom.thundra.${lang}.layer.version`
    )
    const funcLayerVersion = get(func, `custom.thundra.layer.version`)

    const userLayerVersion =
        funcLayerVersion || globalLangLayerVersion || globalLayerVersion

    return userLayerVersion
}
