const get = require('lodash.get')

exports.layerInfo = {
    java: {
        layerName: 'thundra-lambda-java-layer',
        thundraHandlerName:
            'io.thundra.agent.lambda.core.handler.ThundraLambdaHandler',
        needHandlerDelegation: true,
    },
    dotnetcore: {
        layerName: 'thundra-lambda-dotnetcore21-layer',
        needHandlerDelegation: false,
        customRuntime: true,
    },
    python: {
        layerName: 'thundra-lambda-python-layer',
        thundraHandlerName: 'thundra.handler.wrapper',
        needHandlerDelegation: true,
    },
    node: {
        layerName: 'thundra-lambda-node-layer',
        needHandlerDelegation: true,
        thundraHandlerName:
            '/opt/nodejs/node_modules/@thundra/core/dist/handler.wrapper',
    },
    layerAwsAccountNo: 269863060030,
    delegatedHandlerEnvVarName: 'thundra_agent_lambda_handler',
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
