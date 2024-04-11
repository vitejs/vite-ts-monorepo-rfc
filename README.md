# Vite TS Monorepo Setup Comparison

This repo contains two different approaches to setup up a TypeScript monorepo with Vite: one using [tsconfig paths](https://www.typescriptlang.org/tsconfig#paths), and one using [custom conditions](https://nodejs.org/api/packages.html#community-conditions-definitions) in `package.json` exports.

> ⚠️ Note: the setups in this repo are only for comparing / discussing different approaches and are not meant to be production-ready references.

Both setups simulate a simple case of a Vite + TS monorepo where:

- `packages/lib` is a component / utility library that also published to internal or public registries.
- `packages/app` is a Vite application that uses `lib` as a dependency.

`lib` is linked into `app` via pnpm workspace.

As users, our goal is to get:

- Type inference without having to rebuild the `d.ts` file of `lib`.
- Vite HMR when working on `app`, but editing TS source files in `lib`.

Because `lib` is a published package, its `exports` conditions point to the bundled `.js` and `.d.ts` files in its `dist` directory. In order to achieve our goals, we want both TS and Vite to resolve to the source TS files of `lib` instead of its dist files.

## Approach 1: Monorepo setup using tsconfig paths

In `tsconfig.json`:

```json
{
  "compilerOptions": {
    // ...
    "paths": {
      "@test/lib": ["packages/lib/src"],
      // if need deep imports:
      "@test/lib/*": ["packages/lib/src/*"]
    }
  }
}
```

In `app`'s Vite config:

```js
export default defineConfig({
  resolve: {
    alias: {
      '@test/lib': fileURLToPath(new URL('../lib/src', import.meta.url))
    }
  }
})
```

### Pros

- Centralized config: each package's `package.json` is only concerned with its public-facing exports.

- Flexible match: can resolve arbitrary extension types - e.g. an extension-less import can resolve to both `.ts` and `.tsx` files. Also covers non-TS types like Vue / Svelte SFCs.

### Cons

- Currently requires duplicated Vite `resolve.alias` config. This config needs to repeated in every package that consumes `lib`, and all of them needs to be updated when new packages need to be aliased.

  Many users are using [vite-tsconfig-paths](https://www.npmjs.com/package/vite-tsconfig-paths) to simplify this. This plugin has 1.74m weekly downloads (~15% of Vite downloads). Remix uses this plugin by default in its scaffolded projects. Nx also uses a similar [nxViteTsPaths plugin](https://nx.dev/recipes/vite/configure-vite#typescript-paths) by default.

  If Vite provides built-in support that automatically respect tsconfig paths as aliases, then `app` doesn't even need a Vite config file in this case.

- By making `tsconfig` paths the source of the truth, we expect other tools that need to work with source files also use it as the source of truth, or there will still be duplicated alias configurations required.

## Approach 2: Monorepo setup using custom `source` exports condition

In `tsconfig.json`:

```json
{
  "compilerOptions": {
    "customConditions": ["source"]
  }
}
```

In `app`'s Vite config:

```js
export default defineConfig({
  resolve: {
    conditions: ['source']
  }
})
```

### Pros

- Leverages `package.json` exports, which is widely supported across tools and runtimes. Compatible with any tool that supports configuring additional resolve conditions.

- Avoids letting `tsconfig` becoming the source of truth, which conflicts with its original intention.

- Same Vite config for every package.

### Cons

1. For published packages, it might be desirable to avoid exposing the source files to reduce package size. To achieve this, users will need to strip the `source` condition from `package.json` before publishing.

2. To support arbitrary deep imports, [subpath patterns](https://nodejs.org/api/packages.html#subpath-patterns) can be used:

   ```json
   {
     "exports": {
       // ...
       "./*": {
         "source": "./src/*.ts"
       }
     }
   }
   ```

   **The problem arises when the user has a codebase with mixed `.ts` and `.tsx` files, and want to use extension-less imports for both.**

   TypeScript (when using `moduleResolution: "bundler"`) and webpack does support using an array for extension fallbacks:

   ```json
   {
     "exports": {
       // this works as fallbacks in TS & webpack but NOT in Node.js
       "./*": {
         "source": ["./src/*.ts", "./src/*.tsx"]
       }
     }
   }
   ```

   In this case, both TS and webpack will try the entries in the array until a match is found. However, Node.js **stops at the first valid filename regardless of whether the file exists or not**. [More context here](https://github.com/bluwy/publint/issues/92).

   The reason for Node.js' behavior is explained [here](https://github.com/nodejs/node/issues/37928#issuecomment-808833604) and [here](https://github.com/nodejs/node/issues/44282#issuecomment-1220151715) - TL;DR - Node wants to avoid hitting the file system when resolving exports.

   Vite currently [aligns with Node.js behavior](https://github.com/vitejs/vite/issues/4439#issuecomment-1465224035) and will only use the first valid path and error if the file does not exist. This poses a blocker for users who want to use exports conditions with deep, extension-less ts/tsx imports.

   There are two workarounds:

   1. Using a separate subpath pattern for tsx:

      ```json
      {
        "exports": {
          "./*.tsx": {
            "source": "./src/*.tsx"
          },
          "./*": {
            "source": "./src/*.ts"
          }
        }
      }
      ```

      This would require using explicit extensions when importing tsx files:

      ```diff
      - import { bar } from 'lib/src/bar'
      + import { bar } from 'lib/src/bar.tsx'
      ```

   2. Manually list all tsx subpath exports:

      ```json
      {
        "exports": {
          "./bar": {
            "source": "./src/bar.tsx"
          },
          "./*": {
            "source": "./src/*.ts"
          }
        }
      }
      ```

      This is tedious and error-prone.

   Neither workaround is ideal.

3. For deep imports of other file extensions, users will also have to specify exports for all additionally exported file types. This is a less common use case, but when needed, it can be cumbersome and need to be repeated in every package:

   ```json
   {
     "exports": {
       "./*.tsx": {
         "source": "./src/*.tsx"
       },
       "./*.vue": {
         "source": "./src/*.vue"
       },
       "./*.css": {
         "source": "./src/*.css"
       },
       "./*": {
         "source": "./src/*.ts"
       }
     }
   }
   ```

   When using tsconfig paths, this is handled automatically.

## Action Paths for Vite

Ideally, we want to provide the users with a "recommended" approach for setting up TS monorepos, but currently both approaches have some DX paper cuts that need to be addressed.

1. If we were to recommend custom condition in `exports` field:

   - We either make Vite support array fallbacks for conditional exports (This aligns with TS but deviates from Node.js), or users will have to use explicit extensions for deep imports of `.tsx` files.

   - Users who don't want to expose source files in public packages will need an easy way to strip the source conditions from `package.json` before publishing. Currently users have to do this via `prepublish` and `prepublish` scripts. Ideally this can be something that package managers can support via `.npmrc`.

2. If we were to recommend `tsconfig` paths:

   - We should provide built-in support to automatically generate aliases based on `tsconfig` paths.

   - Performance concerns

     There are performance concerns for this, but Vite already has to perform tsconfig resolution internally, so having it built-in should result in better performance than using external plugins like `vite-tsconfig-paths`.

     In the future, Vite will also likely rely on `oxc_resolver` and Rolldown which provides built-in tsconfig paths support with native performance.

   - Alignment concerns

     TS team has expressed that they do not like how tsconfig paths are being widely used because it creates misalignment between TS resolution and standard Node.js behavior.
     
     However, in my opinion this concern only applies in cases where TS is used for transpilation output, and the output code is intended to be run directly with Node.js. It becomes irrelevant for web applications where the source code is almost always processed by a bundler. After bundling, there is no longer resolution happening when the code is executed.
