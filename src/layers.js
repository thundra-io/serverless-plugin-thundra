exports.layerInfo = {
    java: {
        layerName: 'thundra-lambda-java-layer',
        defaultLayerVersion: '14',
        thundraHandlerName: 'io.thundra.agent.lambda.core.handler.ThundraLambdaHandler',
        needHandlerDelegation: true,
    },
    python: {
        layerName: 'thundra-lambda-python-layer',
        defaultLayerVersion: '7',
        thundraHandlerName: 'thundra.handler.wrapper',
        needHandlerDelegation: true,
    },
    node: {
        layerName: 'thundra-lambda-node-layer',
        defaultLayerVersion: '11',
        needHandlerDelegation: false,
        customRuntime: true
    },
    layerAwsAccountNo: 269863060030,
    delegatedHandlerEnvVarName: 'thundra_agent_lambda_handler',
}

exports.getLayerARN = function(region, accountNo, name, version) {
    return 'arn:aws:lambda:' +
            region +
            ':' +
            accountNo +
            ':' +
            'layer:' +
            name +
            ':' +
            version
        
}
