# List of common questions about this app

## Can you get banned for using this app?
No, as stated in the DBD EULA, you can't use any software that interacts, modify or read any aspect of the game, this app doesn't do any of that.  
The app runs on a separate window, requires manual inputs, and does not even know if the game is running or not.  
It is like saying that you can get banned for using Discord while playing DBD.

## Why I can't see the overlay if in FullScreen?
Because, when on FullScreen, the game takes control of the screen and doesn't allow any other app to be on top of it.  
Other apps like Steam and Discord are whitelisted by the game, so they can be on top of the game.
Reminding what is said in the previous question, this app doesn't interact with the game.  
### How to fix
Go to the game graphic settings and set it to "Windowed" or "Windowed Fullscreen"  
By doing this, the game will not take control of the screen and the overlay will be visible.

## The app doesn't work after using a custom image
As stated in this app ToS, the app uses CloudFlare CSAM detection to block any uses of illegal images. This will block the user from using the app.
There will be a manual check of the image, if found to be illegal, the user will be permanently blocked, otherwise you will be unblocked.

## How does auto-detection work?
1. Enable the **Auto-detect map** toggle in the settings — the detector starts immediately and runs fully hands-free.
2. When a match loads, the detector automatically recognizes the loading screen's progress bar and begins scanning the realm/map name using OCR.
3. Once a map is recognized, the overlay updates automatically and the detector switches to a low-cost monitoring mode.
4. When the match ends (endgame screen detected), the overlay clears and the detector returns to watching for the next loading screen.

No key press is needed to start or repeat detection — while the toggle is on the detector runs hands-free. Older versions asked you to press a hotkey (Ctrl+D) at the start of each match; that was removed in v1.6.5. Auto-detect now re-triggers itself automatically on every loading screen, including custom lobbies (unless "Detect maps in Custom Matches" is turned off).

It stays cheap while idle (one lightweight check every 1.5 seconds) and only ramps up full OCR while a match is actually loading. The detector recognizes the map in whatever language your game is set to — it ships with all 15 languages the app supports; limiting OCR to your game language in the Detection settings tab speeds up recognition. If it ever shows the wrong layout/artist for a map, pick your preferred creator in Settings → Detection and it remaps the current overlay.

## Where is the source code of the Server?
Currently, the source code of the server is not public, but it will be in the future.

