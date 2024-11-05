You can contribute by simply creating a fork of this project, make your changes, and then open a pull request.

Here is a basic tutotial on how to do it:

## Fork the project
Click on the fork button on the top right of the project page. This will create a copy of the project in your account.
At the end you should have a project like this: `https://github.com/<YOUR-USERNAME>/dbd-map-overlay`

## Clone the project on your computer
Open a terminal and run the following command:
```bash
https://github.com/<YOUR-USERNAME>/dbd-map-overlay
```
This will create a copy of the project on your computer on the folder `dbd-map-overlay`

## Make your changes
Open the project with your favorite code editor and make your changes.
Please note, if you are not using a code editor, you should add and remove files manually.
- To add a file:
    - Create a new file in the project folder.
    - Run `git add <file-name>` to add the file to the project.
    - Example: `git add maps/MyGroup/MyMap.png`
- To remove a file:
    - Run `git rm <file-name>` to remove the file from the project.
    - Example: `git rm maps/MyGroup/MyMap.png`
If you replace a file, git will automatically detect the change and you don't need to remove the old file.

## Remember to credit the original author
If you are adding a new map style, remember to credit the original author. 

Edit the `CREDITS.md` file and add a new line with the author of the map, and a link to their work.

## Commit your changes
After you have made your changes, you need to commit them.
Run the following command in the terminal:
```bash
git commit -m "Your commit message"
```
Replace `Your commit message` with a short description of the changes you made.

## Push your changes
After you have committed your changes, you need to push them to your fork.
Run the following command in the terminal:
```bash
git push origin master
```

## Open a Pull Request
Go to the project page on Github and click on the `New Pull Request` button.
This will open a page where you can compare the changes you made with the original project.
If everything is correct, click on the `Create Pull Request` button.
This will open a page where you can write a description of the changes you made.

## Wait for the review
After you have opened the pull request, the project owner will review your changes.
If everything is correct, your changes will be merged into the project.