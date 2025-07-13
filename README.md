![Github All Releases](https://img.shields.io/github/downloads/LucaFontanot/dbd-map-overlay/total.svg)
![Github Release Version](https://img.shields.io/github/package-json/v/LucaFontanot/dbd-map-overlay)
![GitHub Release Date](https://img.shields.io/github/release-date/lucafontanot/dbd-map-overlay)
![GitHub License](https://img.shields.io/github/license/lucafontanot/dbd-map-overlay)
# Dbd Map Overlay
Have you ever wasted precious seconds just figuring out how to describe where you are on the map? This is the solution

Tutorial on how to use here https://steamcommunity.com/sharedfiles/filedetails/?id=3014263156
Official site https://dbdmap.lucaservers.com

## How to build yourself:
- Download and extract the project
- Cd into the project
- Run `npm i` to install build tools
- Run `npm run build` to create the exe in the `/dist` directory

## [Credits](./CREDITS.md)
This project would not be possible without the work of all the people creating the minimap illustrations.
Please check the credits to see who contributed to the project and give them support.
## [Changelog](./CHANGELOG.md)
Read the changelog to see what has changed in the latest version.
## [Terms of Service](./TERMS%20AND%20PRIVACY.md)
By using this software you agree to the terms of service
## [CONTRIBUTING](./CONTRIBUTE.md)
Follow this guide if you want to contribute to the project.
By simply helping keeping the maps up to date you are greatly helping the project.
## [LICENSE](./LICENSE)
This software is licensed under the Apache 2.0 License
This means you can use it for free, modify it, and distribute it as long as you give credit to the original author and don't hold them liable.
This software is provided as is, without any warranty or guarantee of any kind.
Not affiliated with Dead by Daylight, Behaviour Interactive, or any of their partners.
## Command-line usage
You can start the app with a map command to display a specific map in the **already** running instance.
**Usage:**
```bash
dbd-map-overlay show-map="Creator/Realm/MapName"
```
- If the application is not running yet, it will start normally and not apply the map.
- If the application is already running, the map will be updated in the background.
- If no map is passed and the app is already running, a popup will inform you that it's already open.
**Map Keys:**
Map keys follow this format:
``
Creator/Realm/MapName
```
Example:
```
SamoelColt/The Macmillan Estate/Suffocation Pit
```
- The key is case-insensitive.
- File extensions are not required.
- If the map name isn't found exactly, the closest match will be used.
