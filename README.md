# 🔥 Ambiglyph CLI
The CLI wrapper of <a href="https://github.com/IZOBRETATEL777/ambiglyph-server" target="_blank">Ambiglyph (Homoglyph Detection Tool)</a>

<img alt="Screenshot of Ambiglyph CLI" src="https://i.imgur.com/mbs6qXr.png">

<h2>❗️Important Point</h2>
<h3>The code has NOT been polished and is provided "as is". There's a lot of code that is redundant and there are tons of improvements that can be made.</h3>

## Install and build

```sh
npm install
npm run build
node dist/index.js --help
```

`npm link` puts it on `PATH` as `ambiglyph`.

The build targets Node ESM, because `got` has been ESM-only since v12. That
rules out `pkg`, which cannot bundle ES modules and has been archived
upstream, so the `compile-linux` / `compile-macos-arm64` scripts are gone.
Standalone binaries would now need Node's own single-executable applications,
or a CJS bundle produced by a bundler first.

## Commands

| Command | What it does |
| --- | --- |
| `ambiglyph login` | Asks for credentials and stores the bearer token in `./.ambi` |
| `ambiglyph logout` | Removes `./.ambi` |
| `ambiglyph add <path>` | Uploads every word of the file to your cloud storage |
| `ambiglyph check <path>` | Checks the file and writes `<path>.remove` with your chosen replacements |

`./.ambi` holds a credential. It is written with mode `0600` and is listed in
`.gitignore`; it is also resolved against the current directory, so `login`
and `check` have to be run from the same place.

## Configuration

Read from the environment or a `.env` file - see `.sample.env`.

| Variable | Meaning |
| --- | --- |
| `url` | Base URL of the Ambiglyph server |
| `version` | Version string reported by `--version` |
| `serverWordPerRequest` | Words sent per request (default 4) |
| `errorText` | Message shown when a request fails |

