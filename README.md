# @nischolas/vite-plugin-umami-inline

Vite plugin that fetches the [Umami](https://umami.is) analytics script at build time and inlines it directly into `index.html`. This prevents the script from being blocked by adblockers, which typically target external tracker URLs.

## Installation

```sh
npm install -D @nischolas/vite-plugin-umami-inline
```

Requires `vite >= 4` as a peer dependency.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { vitePluginUmami } from "@nischolas/vite-plugin-umami-inline";

export default defineConfig({
  plugins: [
    vitePluginUmami({
      hostUrl: "https://your-umami-instance.com",
      websiteId: "your-website-id",
    }),
  ],
});
```

The plugin only runs during `vite build`. Development builds are unaffected.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `hostUrl` | `string` | required | Base URL of your Umami instance. Must use HTTPS. |
| `websiteId` | `string` | required | Umami website ID. |
| `scriptName` | `string` | `"script.js"` | Filename to fetch from `hostUrl`. |
| `fallbackPath` | `string` | — | Path to a local `.js` file used if the fetch fails. |
| `fetchTimeout` | `number` | `5000` | Milliseconds before the fetch is aborted. |
| `retries` | `number` | `1` | Number of retry attempts after the initial failure. |
| `enabled` | `boolean \| (env) => boolean` | `true` | Set to `false` or return `false` from a function to skip injection entirely. The function receives `process.env`. |
| `verbose` | `boolean` | `false` | Log fetch size and duration to the console during build. |

## Behavior on failure

If all fetch attempts fail and no `fallbackPath` is provided, the build continues without injecting the script. An error is logged to the console. Analytics is treated as non-critical — it will never break your build.
