exports.layerInfo = {
    java: {
        layerVersionPropName: 'custom.thundra.java.layer.version',
        layerName: 'thundra-lambda-java-layer',
        defaultLayerVersion: '14',
        thundraHandlerName: 'io.thundra.agent.lambda.core.handler.ThundraLambdaHandler'
    },
    python: {
        layerVersionPropName: 'custom.thundra.python.layer.version',
        layerName: 'thundra-lambda-python-layer',
        defaultLayerVersion: '7',
        thundraHandlerName: 'thundra.handler.wrapper'
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
