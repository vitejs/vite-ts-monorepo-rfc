# RFC: Vite monorepo support

Author: Miles Johnson @milesj

## Problem

Monorepos are becoming more and more popular in the JavaScript ecosystem, thanks in part to the rise of npm/pnpm/yarn workspaces. Monorepos enable a team to move fast by collocating code, sharing code between projects, work in projects in parallel and in real-time, and removing the build -> publish -> install cycle.

However, tooling has yet to fully catch up with these new developer workflows. One of the biggest challenges is how to handle local packages within a monorepo, and how to bundle them in a way that's transparent (ideally) to the developer.

There are a few solutions to this problem that currently exist in the community, but with Vite, we want to support monorepos as a first-class feature. The following document outlines our goals, and proposes a handful of solutions to the problem.

## Goals

- Support bundling of local packages within a monorepo, ideally as transparent as possible.
- Bundling should reference source files, and avoid a build step for local packages.
- Require the least amount of configuration, ideally none (be automatic).

## Concepts

### Package types

Before we dive into the proposal, we should outline what kind of packages may exist in a monorepo:

- **Local only** - These are packages that only exist in the monorepo, are NOT published to a registry, and are NOT used in an external repo. They may or may not have a build step, depending on the owner's preference.
- **Internally published** - These are packages that are published to an internal registry, and are used in multiple private repos, including the current repo it resides in. They may or may not have a build step, depending on the owner's preference.
- **Externally published** - These are packages that are published to a public registry, and are used in tons of private and public repos as a package dependency. They almost always have a build step.

In summary:

|                | Local   | Internal | External        |
| -------------- | ------- | -------- | --------------- |
| **Published**  | No      | Yes      | Yes             |
| **Build step** | Maybe   | Maybe    | Yes             |
| **Visibility** | Private | Private  | Public, Private |
| **Source dir** | Maybe   | Maybe    | Yes             |

### Package workspaces

> Workspaces are REQUIRED for all proposals to work effectively!

A monorepo is a repository that contains multiple packages (libs and apps), and is managed by one or many `package.json` files. This is achieved through the use of workspaces, which is a feature of package managers that installs dependencies from all `package.json`s within the repository, into the same `node_modules` folder.

Furthermore, workspaces allow for local packages to piggy-back on the Node.js module resolution algorithm, by being symlinked into the shared `node_modules` folder. This makes them "available" to other local packages, without having to be published.

- npm: https://docs.npmjs.com/cli/v8/using-npm/workspaces
- pnpm: https://pnpm.io/workspaces
- Yarn: https://yarnpkg.com/features/workspaces

## Proposed solutions

### 1) Source based `package.json` exports

> Suggested by Turborepo for local-only packages.

This solution piggy-backs on `package.json` `exports` to map acceptable import paths to source files. For example:

```json
{
  "exports": {
    ".": "./index.ts",
    "./*": ["./*.ts", "./*.tsx"]
  }
}
```

The above example only works for local and internal only packages, but not external packages. Packages that are published can work around this by adding a custom condition name, like `source` or `development`, that resides alongside `import` or `require`.

```json
{
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "import": "./esm/index.mjs"
    },
    "./*": {
      "source": ["./src/*.ts", "./src/*.tsx"],
      "import": "./esm/*.mjs"
    }
  }
}
```

This would require sources to be published, and introduce a build step for the `esm` target.

#### Existing implementations

- Parcel uses a `source` property (not via `exports`) for local packages in a monorepo.
  - https://parceljs.org/features/dependency-resolution/#package-entries

#### Pros

- "Just works" without much headache.
- Relies on Node.js module resolution.
- Uses functionality current popular in the Node.js ecosystem.
- Sources can be in any directory.

#### Cons

- Requires configuring the package of every `package.json` being imported in the app.
- For published packages, unless the source code is also published, these conditions will be invalid, or they will need to be stripped in a pre-publish step.
- Adds new conditions, which are non-standard and frowned upon by the community.
- Requires an array condition value, which is also non-standard.
- An index entry point forces the use of barrel files, which is a massive performance hit.

### 2) Custom `package.json` export condition

This proposal expands on the previous proposal by introducing a custom condition name, like `vite` or `bundler`, that points to source files.

```json
{
  "exports": {
    ".": {
      "vite": "./src/index.ts",
      "import": "./esm/index.mjs"
    },
    "./*": {
      "vite": ["./src/*.ts", "./src/*.tsx"],
      "import": "./esm/*.mjs"
    }
  }
}
```

#### Pros

- Same pros as the previous proposal.

#### Cons

- Same cons as the previous proposal.
- Adds a new condition name unique to Vite/bundlers, that wouldn't be understood or useable by other tools (without vendor lock-in). This is frowned upon by the community.

### 3) `resolve.alias` mapping

> Currently used community solution!

The tried-and-true method for bundling sources of local packages is to define the `resolve.alias` setting, and map each package name to their source folder. This is the current solution to the problem, but it requires a lot of manual configuration.

```js
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@brand/components": path.join(__dirname, "../packages/components"),
      "@brand/utils": path.join(__dirname, "../packages/utils/src"),
    },
  },
});
```

Once aliases have been defined, you can import from them as if they were installed from npm. Both default and deep imports are supported!

```js
import Button from "@brand/components/Button.vue";
import { camelCase } from "@brand/utils/string";
```

#### Pros

- Easy to understand and implement.
- Sources can be in any directory.
- Doesn't require modifications to package files.
- Works for all package types.

#### Cons

- Requires manual configuration for every package as an alias, in each application's `vite.config.*` file.
- Requires knowledge of aliases and how they work.

### 4) `resolve.localSources` setting (automatic aliases)

This solution would introduce a new setting called `resolve.localSources` that would _automatically_ resolve source files of packages within the current monorepo (instead of referencing built files).

```js
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    localSources: true,
  },
});
```

From the context of Vite, we can easily determine whether a package is local to the monorepo or not, by checking its symlinked `node_modules` file path. If it's a symlink, and the real path resolves to a local repository file, then it's local. Otherwise, it was installed as a standard dependency.

The biggest challenge with this proposal is determining the correct source directory of each package, as this is non-standard. For the most part, many packages use `src` as the source directory, with a handful of others using `sources`, or even `lib`. Additionally, some packages may not have any source directory, and simply place source files in the root of the package (refer to [package types](#package-types) above).

This would require a lot of guesswork, and would most likely result in incorrect file paths. We can work around this with custom configuration, but at that point, it's deviating from our goals. An example of these settings may look something like the following:

```js
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    localSources: true,
    // A lookup for all packages
    sourceDirs: ["src", "sources", "lib"],
    // Per package overrides
    packageSourceDirs: {
      "@brand/components": ".",
      "@brand/utils": "src",
    },
  },
});
```

#### Pros

- Easy to understand and enable (when following a standard source pattern).
- Only needs to be configured once in the base case, instead of for each package.

#### Cons

- Determining the correct source folder is highly error prone.
- When different packages use different source patterns, it becomes unwieldy to manage.

### 5) Vite/bundler `package.json` configuration

This solution is more of an augmentation for other solutions, but the gist is that we support a `vite` (or `bundler` if we want to standardize a bit more) configuration block in `package.json`. This block would store metadata information like the following:

- Where to locate the source directory, relative to the package root.
- Whether the package contains side-effects (moves the `sideEffects` property).
- Bundle targets / browserslists / requirements.
- Other future features that may be useful.

```json
{
  "bundler": {
    "sourceDir": "src",
    "sideEffects": false
  }
}
```

This would alleviate a lot of issues and guesswork for solutions [#4](#4-resolvelocalsources-setting-automatic-aliases) and [#6](#6-stand-alone-plugin).

#### Existing implementations

- Webpack uses the `sideEffects` property to determine if a package has side-effects.
  - https://webpack.js.org/guides/tree-shaking/#mark-the-file-as-side-effect-free
- Parcel requires the `source` property to be set in `package.json`, that points to the entry HTML/JS file.
  - https://parceljs.org/getting-started/webapp/#package-scripts
  - https://parceljs.org/getting-started/library/#project-setup

#### Pros

- Can be used by other bundlers (if we standardize naming).
- Can be used to help other solutions.
- Avoids "generic source detection" as it's explicit.
- Avoids the functionality being built into Vite core.

#### Cons

- Introduces yet more non-standard configuration to `package.json`.
- Requires configuring individual packages (if they aren't using defaults).

### 6) Stand-alone plugin

> Suggested by Nx (but relies on TS paths).

This solution is a combination of ideas from all the previous solutions, primarily #3, #4, and #5, but wraps their functionality in a Vite official plugin. The only benefit of the plugin is that its opt-in, and moves the business logic into a plugin, outside of Vite core.

The usage may look something like the following:

```js
import { defineConfig } from "vite";
import { monorepo } from "vite/plugins";

export default defineConfig({
  plugins: [
    monorepo({
      srcDirs: ["src", "sources", "lib"],
    }),
  ],
});
```

#### Pros

- Same pros as the solutions it wraps.
- Abstracts the implementation outside of Vite core.

#### Cons

- Same cons as the solutions it wraps.
- Doesn't solve any of the cons in the other solutions, if anything, adds more surface area.

## Solutions comparison

Based on our goals.

|                                                  | Ease of use   | Required config | Usable by other tools |
| ------------------------------------------------ | ------------- | --------------- | --------------------- |
| **1) Source based `package.json` exports**       | Easy/Moderate | High            | Yes                   |
| **2) Custom `package.json` export condition**    | Moderate      | High            | Yes                   |
| **3) `resolve.alias` mapping**                   | Easy          | Low             | No                    |
| **4) `resolve.localSources` setting**            | Easy/Moderate | Low/Medium      | No                    |
| **5) Vite/bundler `package.json` configuration** | Easy          | Low/Medium      | Yes                   |
| **6) Stand-alone plugin**                        | Easy/Moderate | Low/Medium      | No                    |

## Recommended solution

Based on all the information we have, I suggest we go with a combination of solution [#4](#4-resolvelocalsources-setting-automatic-aliases) (only the `resolve.localSources` setting) and [#5](#5-vitebundler-packagejson-configuration) (a generic `bundler` property). This will provide us with the least amount of configuration, and the most automation. It also has the following benefits:

- Is opt-in (or opt-out if we enable by default).
- Is not forced on the user.
- Less confusing than the current aliases solution.
- If we can't detect the source file, we simply fallback to normal resolution logic.
- Enables more collaboration with other tools and bundlers.

### Configuration

This is what the configuration would look like for consumers, and how much would be required for it to work correctly.

1. Enable it in the `vite.config.*` file.

```js
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    localSources: true,
  },
});
```

2. For each local/internal package (external packages are excluded), add a `bundler` entry ONLY IF the package deviates from the default settings. These are the proposed defaults:

```json
{
  "bundler": {
    "sourceDir": ".",
    "sideEffects": false
  }
}
```

These defaults assume the packages are local only. For interally published, the required config may look like:

```json
{
  "bundler": {
    "sourceDir": "src"
  }
}
```

3. That's it!

## Vite integrations in the wild

Some research on how Vite is integrated into other tools, and if there's some sort of consistent pattern. Will only document functionality that's relevant to monorepo support.

### moon

Source: https://github.com/moonrepo/moon-configs/tree/master/javascript/vite
Docs: https://moonrepo.dev/docs/guides/examples/vite

moon provides no integration or wrappers around Vite. In moon, `vite` commands are ran as-is using `PATH` lookup (includes `node_modules` paths).

#### Conventions

- Assumes sources are in `src`.
- Assumes tests are in `src` or `tests`.

### Nx

Source: https://github.com/nrwl/nx/tree/master/packages/vite
Docs: https://nx.dev/recipes/vite/configure-vite

Nx provides a handful of code generators for the following scenarios:

- Initializing a project for Vite by updating `nx.json` settings.
- Creating the Vite and Vitest config file based on the current project's needs. Also updates `tsconfig.json` and `nx.json` files.

Nx also wraps the `vite build`, `vite preview`, and other commands to provide a custom Nx executor. There's a lot of overhead here, but the biggest difference is that it looks like it also copies the `package.json` and lockfiles to the `dist` folder.

#### Conventions

- Provides a Vite plugin for resolving projects in the monorepo using TS paths: https://github.com/nrwl/nx/blob/master/packages/vite/plugins/nx-tsconfig-paths.plugin.ts
  - Uses `tsconfig-paths` under the hood.
  - Avoids having to set `resolve.alias` for local sources.
- Assumes sources (and tests) are in `src`.

### Remix

Source: https://github.com/remix-run/remix/tree/main/packages/remix-dev/vite
Docs: https://remix.run/docs/en/main/future/vite

Remix is an app framework with support for Vite as the web server and bundler. Their implementation is powered through a Vite plugin, so it follows best practices.

#### Conventions

- Suggests the `vite-tsconfig-paths` plugin for resolving path aliases from `tsconfig.json`.
- Suggests the `rollup-plugin-visualizer` plugin for visualizing the bundle size.
- Sources are in `app` (`appDirectory` setting) and `public` (`publicPath` setting).

### Storybook

Source: https://github.com/storybookjs/storybook/tree/next/code/builders/builder-vite
Docs: https://storybook.js.org/docs/builders/vite

Storybook provides the ability to use Vite as the web server, instead of Webpack. For the most part, the Vite integration in Storybook is rather straight forward. For build and serve commands, and configuration loading, they import functions from the `vite` package directly.

They modify the config a bit to work with Storybook (like iframe magic), but it's pretty much normal Vite.

### Turborepo

Example: https://github.com/vercel/turbo/tree/main/examples/with-vite

Turbo provides no integration or wrappers around Vite. All `vite` commands are ran through `package.json` scripts.

#### Conventions

- For local packages, Turbo suggests using `exports` that point to source files: https://turbo.build/repo/docs/handbook/sharing-code/internal-packages#4-fix-exports
