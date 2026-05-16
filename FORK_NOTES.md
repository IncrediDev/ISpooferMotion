# External auto-updater launcher

This fork uses a external launcher instead of putting update code inside the Electron app.

## Why

If update code is inside the app, an official upstream update can replace the app and remove the fork-specific updater. The launcher avoids that by living outside the official app install.

## How it works

1. Checks the official GitHub release API for `IncrediDev/ISpooferMotion`.
2. It chooses a Windows release asset.
3. It prefers `.zip` or portable `.exe` assets because those can live inside the managed launcher folder.
4. If the official release only provides a normal installer `.exe`, the launcher downloads it, runs it silently, locates the installed app, and launches it.
5. Future official updates replace only the managed/official app files. The launcher remains separate.

## Build the launcher

From the `launcher` folder:

```bash
npm install
npm run build:win
```

The output will be:

```text
Desktop/ISpooferMotion
```

## Test without building

```bash
cd launcher
npm install
npm start
```