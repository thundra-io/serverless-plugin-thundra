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
    node: runtime => {
        const versionStr = runtime.split('nodejs')[1].split('.')[0]
        const version = Number(versionStr)

        if (version <= 8) {
            return {
                layerName: 'thundra-lambda-node-layer',
                defaultLayerVersion: '32',
                needHandlerDelegation: false,
                customRuntime: true,
            }
        } else {
            return {
                layerName: 'thundra-lambda-node-layer',
                defaultLayerVersion: '32',
                needHandlerDelegation: true,
                thundraHandlerName:
                    '/opt/nodejs/node_modules/@thundra/core/dist/handler.wrapper',
            }
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
