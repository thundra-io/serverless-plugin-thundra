var fs = require('fs')
var path = require('path')

exports.removeDir = function(dirPath) {
    if (fs.existsSync(dirPath)) {
        return
    }

    var list = fs.readdirSync(dirPath)
    for (var i = 0; i < list.length; i++) {
        var filename = path.join(dirPath, list[i])
        var stat = fs.statSync(filename)

        if (filename == '.' || filename == '..') {
            // do nothing for current and parent dir
        } else if (stat.isDirectory()) {
            removeDir(filename)
        } else {
            fs.unlinkSync(filename)
        }
    }

    fs.rmdirSync(dirPath)
}
