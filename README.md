# 🔥 Ambiglyph CLI
Finds homoglyphs - look-alike characters such as a Cyrillic "а" posing as a
Latin "a" - along with mixed-script words and invisible characters, in your
files and offline. It started as the CLI wrapper of
<a href="https://github.com/rtolstosheyev/ambiglyph-server" target="_blank">Ambiglyph (Homoglyph Detection Tool)</a>,
whose server it can still talk to.

<h2>❗️Important Point</h2>
<h3>The code has NOT been polished and is provided "as is". There's a lot of code that is redundant and there are tons of improvements that can be made.</h3>

## Install and build

```sh
npm install
npm run build
node dist/index.js --help
```

`npm link` puts it on `PATH` as `ambiglyph`. It needs Node 22 or newer.

## Checking files

```sh
ambiglyph check                    # everything under the current directory
ambiglyph check README.md src      # files and directories
ambiglyph check 'docs/**/*.md'     # globs, expanded by ambiglyph itself
git show | ambiglyph check -       # standard input
```

```
docs/login.md:12:9  mixed-script  "pаypal" mixes Latin with Cyrillic: а U+0430 (Cyrillic) -> paypal
src/auth.ts:40:23  invisible  U+202E RIGHT-TO-LEFT OVERRIDE can reorder how the text around it is displayed (remove it)
2 problems in 2 of 31 files checked
```

Each finding is `file:line:column`, the rule, what is wrong and, when there is
one, the fix. Columns count UTF-16 code units, as ESLint and tsc do. Findings
go to standard output and the summary to standard error.

| Rule | Reported when |
| --- | --- |
| `mixed-script` | A word mixes scripts and a letter of the minority script passes for one of the majority: the Cyrillic "а" in "pаypal", or a Latin "p" in a Russian word. A mix with nothing to mistake, such as "Δt", is fine. |
| `confusable` | A word holds a compatibility, mathematical or ligature form that Unicode restricts in identifiers: "ｐａｙ", "𝐩𝐚𝐲", "ﬁle". |
| `invisible` | Zero-width characters, the Hangul fillers, bidi controls that can reorder a line ("Trojan Source"), and tag characters, whose hidden text is decoded and shown. |

Ordinary text in any one script, Azerbaijani "ə" and "ı" included, is left
alone.

Directories are walked including dotfiles such as `.github`, but skipping
`node_modules` and `.git`. A file with a NUL byte in its first 8000 bytes is
taken as binary and skipped.

### In CI and git hooks

The exit status is 0 when nothing is found, 1 when something is, and 2 when
the check could not run: a missing file, a glob that matches nothing, or a bad
option.

`--json` prints all findings as one array. Each has `file`, `line`, `column`,
`rule`, `message`, `text` (the word), `suggestion` (absent when there is none,
empty when the fix is to delete), `index` (UTF-16 offset in the file) and
`suspects`, one per character, with its `char`, `codePoint`, `script`, `index`
and `replacement`.

A pre-commit hook that checks what is being committed:

```sh
#!/bin/sh
git diff --cached --name-only --diff-filter=ACMR -z | xargs -0 -r ambiglyph check
```

### Where the verdicts come from

The lookalike table is generated from the Unicode 18.0.0 security data
(UTS #39) by `scripts/generate-confusables.mjs`. It keeps 1800 of the 6712
entries in `confusables.txt`: the letters and digits outside ASCII that pass
for a Latin letter or an ASCII digit, split by `IdentifierStatus.txt` into
ordinary letters of other scripts and restricted forms. It is 17.5 KB of ASCII
escapes in `src/engine/confusables.ts`; `npm run confusables` regenerates it,
and `npm run confusables -- 19.0.0` moves it to another version.

The suggested fix is the letter the character stands for, not the raw UTS #39
prototype, which maps "I" and "1" to "l" and "m" to "rn". So a Cyrillic "І"
becomes "I", and a Cyrillic "ә" in Azerbaijani text becomes the Latin "ə".

On Node 24 a single file is checked in about 55 ms, most of which is Node
starting up, and all 3,100 files of this project's `node_modules` (41 MB) in
about 0.2 s. A file that is pure ASCII is settled on its raw bytes; text runs
at roughly 90 MB/s in Russian or Azerbaijani, where every word has to be
looked at, and several hundred MB/s in English.

## Server commands

The original Ambiglyph backend is a Java and MySQL service that checks words
against its dictionary. The instance this CLI was written against no longer
answers, so these commands need a server of your own, named by `url`.

| Command | What it does |
| --- | --- |
| `ambiglyph login` | Asks for credentials and stores the bearer token in `./.ambi` |
| `ambiglyph logout` | Removes `./.ambi` |
| `ambiglyph add <path>` | Uploads every word of the file to your word list |
| `ambiglyph check --server <path>` | Checks one file, asks which replacement to use for each detection, and writes `<path>.remove` |

`check --server` is what `check <path>` did before the offline check existed.

`./.ambi` holds a credential. It is written with mode `0600` and is listed in
`.gitignore`; it is also resolved against the current directory, so `login`
and `check --server` have to be run from the same place.

Configuration is read from the environment or a `.env` file in the current
directory - see `.sample.env`. Only the server commands read it.

| Variable | Meaning |
| --- | --- |
| `url` | Base URL of the Ambiglyph server |
| `serverWordPerRequest` | Words sent per request (default 4) |
| `errorText` | Message shown when a request fails |

## Standalone binaries

The build targets Node ESM, because `got` has been ESM-only since v12. That
rules out `pkg`, which cannot bundle ES modules and has been archived
upstream, so the `compile-linux` / `compile-macos-arm64` scripts are gone.
Standalone binaries would now need Node's own single-executable applications,
or a CJS bundle produced by a bundler first.
