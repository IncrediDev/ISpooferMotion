# Changelog

## v1.3.12

- **API key fixes:** Replacing an Open Cloud API key now properly overwrites the old key, validates the key when possible, and shows clearer messages for missing, invalid, expired, or permission-limited keys.
- **Profile fixes:** Updating a profile now fully replaces the old profile data instead of merging stale values back in, with safer saving so profile changes persist more reliably.
- **Animation and sound mapping fixes:** Improved processing so valid assets can still produce mappings when other assets fail, with clearer summaries for failed downloads/uploads instead of generic "no mappings" errors.
- **Better Place ID discovery:** Added automatic Place ID lookup from a User ID or Group ID, including multi-place suggestions and saving the selected place.
- **More reliable Place ID lookup:** Place search now tries more Roblox lookup paths, can fall back between user-owned and group-owned results for the same ID, and shows clearer next steps instead of failing with a generic "no places found" error.
- **Cookie auto-detect improvements:** Auto detect now checks Roblox Studio and browser profiles and uses whichever valid cookie it finds first.
- **Welcome tour improvements:** The welcome tour now appears on first launch and after new app versions.
- **Roblox Studio plugin fixes:** Improved ID extraction for animations and sounds, reduced scan throttling, and added better messages when IDs are found but Roblox metadata cannot confirm them.
- **Fresh plugin scans:** The Studio plugin now scans the live place each time instead of relying on indexing or cached scan results, so newly added or changed animation and sound IDs are picked up consistently.
- **Cleaner pasted plugin output:** The app now ignores the generated script wrapper, `TYPE:` marker lines, and whitespace-only or invisible formatting lines when pasted into the spoof input, preventing noisy invalid-line errors.

## v1.3.11

- **Interactive Welcome Tour:** Added a interactive onboarding tour to guide new users through setting up their cookies, API keys, and run options.
- **Advanced Asset Renaming:** You can now automatically rename your assets on upload using custom prefixes, suffixes, or find-and-replace rules (found in Settings -> Upload Engine Defaults).
- **Replace Existing Assets:** Added a new toggle to overwrite your existing creations instead of uploading duplicates.
- **Unified Roblox Plugin:** "Extract IDs" and "Replace IDs" are now housed together in a single window.
- **UI Upgrades:** Polished the UI design across the entire application and plugin.
- **Page Restorations:** Profiles, Settings, and Activity pages are now fully re-enabled with their complete feature sets.
- **Bug Fixes:** Fixed various layout quirks and Spoofer bugs.

## v1.3.10-hotfix.1

- Kept everything minimal until everything is PROVEN to work

## v1.3.10

- Fixed ISpooferLauncher showing the default Electron icon.
- Made ISpooferLauncher open an already installed ISpooferMotion much faster while it checks for updates in the background.
- Added a prompt when the testing fork has a newer update, with options to keep using the official release or switch to the fork build.
- Moved saved profile cookies and Open Cloud API keys into secure system credential storage.
- Kept app notifications under control by showing no more than four at once.
- Improved asset download fallback behavior for assets that Roblox does not return cleanly from the normal batch lookup.
- Made blocked/private source asset failures clearer so it is easier to tell when the current account or place does not have access.
- Made copied debug info safer by hiding sensitive account data and local user paths.
- Reverted to an older UI that was honestly better (Colours and certain button locations)
- Fixed animation ID processing that could incorrectly fail with Roblox private-asset errors even when the account/place had access.
- Improved fallback checks for source assets by retrying Roblox's place-aware asset lookup before falling back to direct downloads.
- Restored user-account uploads to always use the resolved Roblox user as the upload creator.
- Made upload setup stop early with a clear error when the app cannot resolve the Roblox user ID.

## v1.3.0

I'm too lazy to write a changelog, just know everything is better than it was before.

This is also the final big update before V1 goes into maintenance mode, so from here on out it’ll only be getting bug fixes, stability improvements, and small patches unless something major needs attention.

- Bye Incred UI, Hello Cody UI.

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
