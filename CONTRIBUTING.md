# Contributing to Lumina

Thanks for wanting to help. Lumina is small on purpose: plain JavaScript, no framework, no build step and no 3D library. Contributions that keep it that way are the easiest to accept.

## Getting set up

```bash
git clone https://github.com/Osama-kn/lumina.git
cd lumina
npm install
npx playwright install chromium   # once, for the browser tests
npm start                         # http://localhost:5173
npm test
```

## Good first contributions

- **A new model.** A 3D file with good part names, or a model written as code. See [docs/adding-models.md](docs/adding-models.md). Please only add files you have the right to share, and credit them in `examples/CREDITS.md`.
- **Better explanations.** Part descriptions that are clearer or more accurate.
- **Anything on the roadmap** in the README.
- **Bug reports** with steps to reproduce, your browser, and whether you used a camera.

## Guidelines

- **Tests first.** Add a test that fails without your change. Unit tests live in `tests/unit` (Node's test runner); browser tests live in `tests/e2e` (Playwright). `npm test` must pass.
- **No new runtime dependencies.** Development-only tools are fine if they're small.
- **Keep the GPU and its JavaScript copy in step.** If you change the physics shader in `src/gl/shaders.js`, change `src/logic/physics.js` to match; a test compares them.
- **12 parts at most.** The shaders' uniform arrays hold 12 entries (`MAX_PARTS` in `src/models/core.js`).
- **Style.** Two-space indentation, ES modules, and small focused files. Comments should explain *why*, not *what*.

## Pull requests

1. Fork the repository and create a branch.
2. Make your change with tests.
3. Run `npm test`.
4. Open a pull request saying what changed and why. Include a screenshot if it changes how something looks.

By contributing, you agree that your contribution is released under the project's [MIT licence](LICENSE).
