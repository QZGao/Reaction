# Reaction

Project page: [meta:Reaction](https://meta.wikimedia.org/wiki/Reaction)

This gadget allows users to add reaction emojis (like 👍, ❤️, 😂, etc.) to comments on talk pages across Wikimedia projects. It enhances user interaction and engagement by providing a simple way to express feedback.

## Installation

### Distributed build

To use Reaction on one of the supported wikis, or install it on all wikis:

- For one wiki: Add the following line to your `common.js` page on that wiki ( e.g. [English Wikipedia `common.js`](https://en.wikipedia.org/wiki/Special:MyPage/common.js) ).
- For all wikis: Add the following line to your [`global.js` page on Meta-Wiki](https://meta.wikimedia.org/wiki/Special:MyPage/global.js).

```js
mw.loader.load("//meta.wikimedia.org/w/index.php?title=User:SuperGrey/gadgets/Reaction.js&action=raw&ctype=text/javascript"); // Backlink: [[meta:Reaction]]
```

### Build from source

```bash
npm install
npm run build
```

Upload `dist/bundled.js` to your wiki userspace (e.g., `User:YourName/Reaction.js`) and add the following line to your `common.js` or `global.js` page:

```js
mw.loader.load("//your.wiki.org/w/index.php?title=User:YourName/Reaction.js&action=raw&ctype=text/javascript");
```

## Prepare Template and Module on your wiki

If your wiki does not host `Template:Reaction` and `Module:Reaction`, you need to install those first.

1. Create `Template:Reaction` with the content from [`wikitext/Reaction.template.wikitext`](wikitext/Reaction.template.wikitext).

2. Create `Template:Reaction/styles.css` with the content from [en:Template:Reaction/styles.css](https://en.wikipedia.org/wiki/Template:Reaction/styles.css).

3. Clone or download this repository, then run the following command to build the localized wikitext modules:

   ```bash
   npm install
   npm run build:wikitext
   ```

4. Choose the appropriate language version of `Module:Reaction` from the generated `dist/Reaction.module.*.lua` files and create `Module:Reaction` on your wiki with its content.

## Development

```bash
npm run build:debug   # Build with sourcemaps
npm run lint          # ESLint check
npm test              # Run Vitest tests
```

### Manual debugging from the browser console

You can test Reaction by pasting the bundle directly into a wiki tab:

1. Run `npm run build:debug`. The output appears at `.debug/bundled.js`.
2. Open that file, copy its entire contents, and switch to the wiki article you want to test.
3. Open the browser DevTools console (`F12`/`Ctrl+Shift+I`) on that page and paste the bundle. It bootstraps itself the same way the gadget loader does, so Reaction immediately mounts in the current tab.
4. When you rebuild, reload the wiki page and repeat the paste to pick up the changes. Keeping `npm run build:debug --watch` in another terminal helps rebuild automatically; you only need to re-paste after each build.

### VS Code debugging

The repository ships with a ready-to-run Firefox debugging workflow for VS Code. The `.debug/manifest.json` web extension installs a content script (`inject.js`) that injects the freshly built `.debug/bundled.js` bundle into any `*.wikipedia.org` page, letting you test Reaction like a normal gadget while still using VS Code breakpoints and sourcemaps.

1. Install the **Debugger for Firefox** extension in VS Code (it provides the `"firefox"` debug type).
2. Open the *Run and Debug* panel and select **Debug Reaction on Wikipedia**.
3. Press ▶️. The pre-launch task defined in `.vscode/tasks.json` runs `npm run watch:debug`, which keeps rebuilding `.debug/bundled.js` with inline sourcemaps.
4. VS Code launches Firefox to the URL from `launch.json` and sideloads the `.debug` extension. The debugger auto-reloads the page whenever `bundled.js`, `inject.js`, or `manifest.json` change, so edits + saves immediately refresh the gadget.
5. Set breakpoints anywhere in the TypeScript source; Firefox hits them against the rebuilt bundle thanks to the sourcemaps produced by the debug build.

Tip: Update `url` in `.vscode/launch.json` if you want the debug session to start on another article or wiki. Stop the debug session to terminate the `watch:debug` background task.

**Disable the Meta-hosted loader while debugging.** If your user `common.js` (or `global.js`) loads the Meta-hosted script, add a guard to skip it when you are running the local debug extension:

```js
(() => {
  const isDev = localStorage.getItem('reaction-dev') === '1';
  if (isDev) return;

  mw.loader.load("//meta.wikimedia.org/w/index.php?title=User:SuperGrey/gadgets/Reaction.js&action=raw&ctype=text/javascript"); // Backlink: [[meta:Reaction]]
})();
```

The debug extension sets `localStorage["reaction-dev"] = "1"` at `document_start`, so the remote loader is disabled for the debug profile. To restore the online version:

```js
localStorage.removeItem('reaction-dev');
location.reload();
```
