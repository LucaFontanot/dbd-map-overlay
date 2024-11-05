const path = require("path");
const fs = require("fs");
const crypto = require('crypto');
function getFilesFromDir(dirPath) {
    let results = [];
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
            results = results.concat(getFilesFromDir(filePath));
        } else {
            results.push(filePath);
        }
    }
    return results;
}
function computeMD5(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

async function main(){
    const dirPath = path.join(__dirname, "maps");
    const files = getFilesFromDir(dirPath);
    const output = files.map(filePath => ({
        filePath: filePath.toString().replace(dirPath.toString(), "maps").replace(/\\/g, "/"),
        md5: computeMD5(filePath)
    }));
    console.log(JSON.stringify(output, null, 2));
}

main();