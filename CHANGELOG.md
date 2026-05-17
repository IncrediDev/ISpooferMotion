# Changelog

## v1.2.16

This update is mostly just polish. I spent like 12 hours doing all of this so enjoy.

### Launcher and installs
- Added a proper Electron launcher instead of the old console-style launcher.
- The launcher is now the main place to install, update, launch, and uninstall ISpooferMotion.
- Added automatic release checking from GitHub.
- Added automatic Roblox Studio plugin install from the release `.rbxmx` file.
- Added a deep uninstall button in the launcher (removes managed app files, old app data folders, shortcuts, temp files, and ISpooferMotion plugin files.).
- Cleaned up update/install leftovers after downloads finish.
- Made install/uninstall fail faster instead of sitting on Working forever when the release asset is wrong.
- Moved all launcher-created data folders to `ISpooferMotion` instead of lowercase/random names.

### Main app
- Added Profiles so common setups can be saved and reused.
- Profiles save account/settings stuff like cookie, Open Cloud API key, group ID, folders, retry settings, and concurrency settings.
- Profiles do not save animation/sound input lists or output results.
- Added a settings dropdown in the titlebar.
- Added a profiles dropdown in the titlebar.
- Added a Get button beside Open Cloud API Key that opens Roblox Creator credentials.
- Added queue and run report popouts so the main window is cleaner.
- Cleaned up the queue so it is easier to read during large batches.
- Cleaned up the run report and removed repeated footer/output text.
- Removed pointless footer status text that was already shown in the report.
- Added custom upload/download concurrency controls.
- Added custom scrollbars.

### Batch processing
- Fixed the raw Roblox cookie header in batch requests.
- Removed the old required CSRF fetch since the current upload flow does not need it.
- Added download concurrency limits.
- Added retry/cooldown handling for rate limits and temporary failures.
- Added a failed-item retry flow.
- Added project/session saving and restore support.
- Added an asset history cache for successful old ID to new ID mappings.
- Added fallback single-asset checks when batch lookup fails.
- Added better failure categories, including invalid cookie, invalid API key, asset access denied, rate limited, network failure, and file conversion failed.
- Changed source asset 403 errors so they show as asset access problems instead of blaming group permissions.

### Roblox Studio plugin
- Added support for the remade Get IDs UI.
- Added support for the remade Replace IDs UI.
- Added a build script so the workflow can turn the plugin source into a `.rbxmx` release asset.

### Releases
- Added a tag-based release workflow.
- Release builds now upload the launcher setup EXE, the managed app EXE, and the Roblox Studio plugin `.rbxmx`.
- Release notes now come from this changelog instead of needing to type them manually every time.

### Cleanup and safety
- Tightened external link opening so only expected trusted links can be opened.
- Tightened packaging so random build folders, downloads, launcher files, and repo metadata do not get bundled into the app.
