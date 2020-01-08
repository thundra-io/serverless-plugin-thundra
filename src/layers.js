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
    node: (func, service) => {
        const optsWithCR = {
            layerName: 'thundra-lambda-node-layer',
            defaultLayerVersion: '32',
            needHandlerDelegation: false,
            customRuntime: true,
        }

        const optsWithoutCR = {
            layerName: 'thundra-lambda-node-layer',
            defaultLayerVersion: '32',
            needHandlerDelegation: true,
            thundraHandlerName:
                '/opt/nodejs/node_modules/@thundra/core/dist/handler.wrapper',
        }

        const useCustomRuntime =
            _.get(func, 'custom.thundra.useCustomRuntime') ||
            _.get(service, 'custom.thundra.useCustomRuntime') ||
            false

        const versionStr = func.runtime.split('nodejs')[1].split('.')[0]
        const version = Number(versionStr)

        if (useCustomRuntime || version <= 8) {
            return optsWithCR
        } else {
            return optsWithoutCR
        }
    },
    layerAwsAccountNo: 269863060030,
    delegatedHandlerEnvVarName: 'thundra_agent_lambda_handler',
}

exports.getLayerARN = function(region, accountNo, name, version) {
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
