const {ensureDirectoryExistence, getFilesFromDir, deleteDirectoryContents} = require("./utils");
const {app, ipcMain} = require("electron");
const fs = require("fs");
const path = require("path");

class UserData {
    constructor() {
        ipcMain.handle('read-user-data', async (event, fileName) => {

            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "photo", fileName)
            ensureDirectoryExistence(fileDir)

            if (!fs.existsSync(fileDir)) {
                return Buffer.from("")
            }
            return await fs.promises.readFile(fileDir);
        })
        ipcMain.handle('read-custom-data', async (event, fileName) => {
            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "custom", fileName)
            ensureDirectoryExistence(fileDir)
            if (!fs.existsSync(fileDir)) {
                return Buffer.from("")
            }
            return await fs.promises.readFile(fileDir);
        })
        ipcMain.handle('write-user-data', async (event, fileName, data) => {
            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "photo", fileName)
            ensureDirectoryExistence(fileDir)
            fs.writeFileSync(fileDir, Buffer.from(data));
        })
        ipcMain.handle('write-custom-data', async (event, fileName, data) => {
            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "custom", fileName)
            ensureDirectoryExistence(fileDir)
            fs.writeFileSync(fileDir, Buffer.from(data));
        })
        ipcMain.handle('delete-user-data', async (event, fileName) => {
            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "photo", fileName)
            ensureDirectoryExistence(fileDir)
            fs.unlinkSync(fileDir);
        })
        ipcMain.handle('delete-custom-data', async (event, fileName) => {
            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "custom", fileName)
            ensureDirectoryExistence(fileDir)
            fs.unlinkSync(fileDir);
        })
        ipcMain.handle('get-dir-photos', async (event, dir) => {
            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "photo")
            if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir)
            }

            return getFilesFromDir(fileDir).map((file) => {
                return file.replace(fileDir.toString(), "")
            })
        })
        ipcMain.handle('get-custom-photos', async (event, dir) => {
            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "custom")
            if (!fs.existsSync(fileDir)) {
                fs.mkdirSync(fileDir)
            }

            return getFilesFromDir(fileDir).map((file) => {
                return file.replace(fileDir.toString(), "")
            })
        })
        ipcMain.handle('clear-photos', async (event, dir) => {
            const userdata = app.getPath('userData');
            const fileDir = path.join(userdata, "photo")
            await deleteDirectoryContents(fileDir)
        })
    }
}

module.exports = UserData;