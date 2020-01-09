const _ = require('lodash')

exports.layerInfo = {
    java: {
        layerName: 'thundra-lambda-java-layer',
        defaultLayerVersion: '37',
        thundraHandlerName:
            'io.thundra.agent.lambda.core.handler.ThundraLambdaHandler',
        needHandlerDelegation: true,
    },
    python: {
        layerName: 'thundra-lambda-python-layer',
        defaultLayerVersion: '17',
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
        defaultLayerVersion: '33',
        needHandlerDelegation: false,
        customRuntime: true,
    }

    const optsWithoutCR = {
        layerName: 'thundra-lambda-node-layer',
        defaultLayerVersion: '33',
        needHandlerDelegation: true,
        thundraHandlerName:
            '/opt/nodejs/node_modules/@thundra/core/dist/handler.wrapper',
    }

    try {
        const withoutCRVersionThreshold = 32

        const eligibleForWithoutCR =
            userLayerVersion === 'latest' ||
            Number(userLayerVersion) > withoutCRVersionThreshold

        const useCustomRuntime =
            _.get(func, 'custom.thundra.useCustomRuntime') ||
            _.get(service, 'custom.thundra.useCustomRuntime') ||
            false

        const versionStr = func.runtime.split('nodejs')[1].split('.')[0]
        const version = Number(versionStr)

        if (!eligibleForWithoutCR || useCustomRuntime || version <= 8) {
            return optsWithCR
        }

        return optsWithoutCR
    } catch (e) {
        return optsWithCR
    }
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
    const globalLayerVersion = _.get(service, 'custom.thundra.layer.version')
    const globalLangLayerVersion = _.get(
        service,
        `custom.thundra.${lang}.layer.version`
    )
    const funcLayerVersion = _.get(func, `custom.thundra.layer.version`)

    const userLayerVersion =
        funcLayerVersion || globalLangLayerVersion || globalLayerVersion

    return userLayerVersion
}
