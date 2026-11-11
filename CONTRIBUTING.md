# Contributing

Thanks for helping with Crosswalk. Issues and pull requests are welcome at https://github.com/crosswalkjs/crosswalk.

## Working on it

```bash
npm install
npm test
npm run typecheck
npm run build
npm run playground
```

For the .NET runtime, in `dotnet/`: `dotnet test`.

The browser tests in [`e2e/`](e2e/) drive the real editor with the pointer and keyboard: linking, dragging, selecting, pages, sub-maps, copy and paste. They serve a small fixture page from the source on port 5180. The first time, install the browser with `npx playwright install chromium`, then:

```bash
npm run e2e
```

One of them checks the editor stays quick with 1,200 operators. To see how redraws grow from 100 to 2,000 operators, run `PERF_SWEEP=1 npx playwright test e2e/perf.spec.ts`, adding `THROTTLE=4` to slow the CPU down to a typical laptop's.

The playground (http://localhost:5173) has the editor above the map JSON, an input and the live output. Both editors stay in sync. It also shows a custom operator category (People) and a custom theme (Aurora).

The documentation site is in [`website/`](website/README.md).

[`conformance/`](conformance/README.md) defines what a map means as test cases that every runtime must pass. The TypeScript core runs them with `npm test`.

## Releasing

1. Bump `version` in `packages/core/package.json`, `packages/canvas/package.json` (and the canvas's dependency on core) and `dotnet/Directory.Build.props`, then commit.
2. Publish a GitHub release. The Release workflow publishes both packages to npm with provenance, and `Crosswalk.Core` to NuGet.

The repo's `.npmrc` pins the public npm registry, whatever your own npm config says.
