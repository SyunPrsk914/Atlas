# Running Atlas on your own computer, with Ollama and `qwen3:8b`

A step-by-step guide from an empty folder to a working local Atlas whose AI runs
entirely on your machine — no API key, no account, no provider quota, and no
essay or profile leaving the computer.

It assumes you have **Ollama**, **GitHub Desktop** and the **`qwen3:8b`** model
installed already, which covers most of it. The one thing you still need is
**Node.js 22.13 or newer** (a JSON viewer is not needed by anything here).

Everything below takes about 15 minutes, most of it waiting for `npm install`.

---

## 1. Install Node.js (once)

1. Open https://nodejs.org and install the **LTS** version (22.x or newer).
2. Check it in a terminal (on Windows, “Command Prompt” or PowerShell; on macOS,
   “Terminal”):

   ```bash
   node -v
   npm -v
   ```

   **You should see** `v22.13.0` or higher, and an npm version. Atlas needs
   Node 22.13+ because the PDF reader (pdf.js 6) requires it — on an older Node,
   uploading a PDF to Materials fails.

## 2. Clone the repository with GitHub Desktop

1. Open **GitHub Desktop** and sign in to the GitHub account that can see
   `SyunPrsk914/Atlas`.
2. **File → Clone repository…** → the **GitHub.com** tab → pick **`SyunPrsk914/Atlas`**.
3. Leave **Local Path** somewhere you will find again (for example
   `C:\Users\you\Documents\GitHub` on Windows or `~/Documents/GitHub` on macOS),
   then **Clone**.
4. When the clone finishes, GitHub Desktop offers **“Show in Explorer/Finder”**
   and, in the **Repository** menu, **“Open in Command Prompt”** (Windows) or
   **“Open in Terminal”** (macOS). Use that — it puts you in the right folder.

   Check you are in the right place:

   ```bash
   git branch --show-current
   ```

   **You should see** a branch name (for example `main`). If you want the work
   from a specific branch instead, switch to it in GitHub Desktop's branch list
   first — the folder on disk always follows the branch GitHub Desktop shows.

## 3. Check Ollama is running and has the model

Ollama must be **running** (its app in the background, or `ollama serve` in a
terminal) for the whole time you use Atlas.

```bash
ollama list
```

**You should see** a table containing `qwen3:8b`. If it is missing:

```bash
ollama pull qwen3:8b
```

That is a ~5 GB download. Roughly: 16 GB of system RAM is comfortable, 8 GB is
the practical minimum, and a bigger context window (step 5) needs more memory
than a smaller one.

Now check the server answers on the port Atlas uses:

```bash
curl http://127.0.0.1:11434/api/tags
```

(on Windows use `curl.exe http://127.0.0.1:11434/api/tags`, because plain
`curl` in PowerShell is an alias for something else.)

**You should see** JSON containing `"qwen3:8b"`. If you see *connection
refused*, Ollama is not running — open the Ollama app, or run `ollama serve` in
a second terminal and leave it open.

Optional, and worth doing once — this is the exact call Atlas makes, and it
proves the model reasons on your machine:

```bash
curl http://127.0.0.1:11434/api/show -d "{\"model\": \"qwen3:8b\"}"
```

**You should see** `"thinking":{"values":[false,true],"default":true}` somewhere
in the answer. That is the model telling Atlas it has a reasoning mode.

## 4. Install Atlas's dependencies

In the terminal that is sitting in the cloned folder:

```bash
npm install
```

**You should see** a few deprecation warnings and then
`added 573 packages in …s`. The warnings are normal.

## 5. Create `.env.local`

In the **root of the cloned folder** (next to `package.json`), create a file
named exactly `.env.local` — with the dot, and no `.txt` at the end — containing:

```dotenv
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen3:8b
OLLAMA_NUM_CTX=16384
```

What each line does:

| Line | Why |
|---|---|
| `LLM_PROVIDER=ollama` | Tells the Atlas server to call your local Ollama. Without it, Atlas stays in labeled **demo mode** and never calls a model. |
| `OLLAMA_MODEL=qwen3:8b` | The model to run. It must match `ollama list` exactly, including the `:8b`. |
| `OLLAMA_NUM_CTX=16384` | The context window per call. A reasoning model keeps its chain of thought inside this same window, so this is room for a document, the instructions, the reasoning and the answer. `qwen3:8b`'s own limit is 40960 tokens — Atlas reads the real number from the model and shows it in AI setup. Start here rather than higher: the window costs video memory on every call whether the prompt is long or not (see *Not enough memory for the model* below). Lower it to `8192` if your machine is short of memory. |

Reasoning is **on by default** — you do not need a line for it. The knobs that
exist if you ever want them (`OLLAMA_THINK`, `OLLAMA_THINK_BUDGET`,
`OLLAMA_MIN_TEMPERATURE`, `OLLAMA_TIMEOUT_MS`, `OLLAMA_KEEP_ALIVE`) are all
documented in `.env.example` and in **DEPLOYMENT.md, Part 2.7**.

`.env.local` is git-ignored, so GitHub Desktop will never try to commit it.

You do **not** need Supabase or any API key for this setup: with no Supabase
variables, Atlas keeps your data in the browser (demo storage) and the AI
endpoint accepts local requests.

## 6. Start Atlas

```bash
npm run dev
```

**You should see** a line like `➜  Local:   http://localhost:5173/`. Open that
URL in your browser. Leave the terminal open — Ctrl+C in it stops the server.

## 7. Turn the local model on in the app

1. In the sidebar, click the **AI setup / AI status** pill.
2. Press **Re-check**.
3. Press **Use Ollama (local)**.

**You should see**, under the model picker:

> **Reasoning is on for qwen3:8b**
> Atlas asks it to think on every call, keeps the trace out of the answer, and
> reserves 8,192 output tokens for it so the answer is never cut short by the
> thinking that produced it.
> Context window 32,768 tokens · this model's own limit is 40,960 · Atlas waits
> up to 30 minutes for one answer.

(The limit and the budget shown are read from your own model and your
`.env.local`, so your numbers may differ.)

The model dropdown marks reasoning models with **· reasons first**. If the panel
says “has no reasoning mode”, the model in `OLLAMA_MODEL` is not the one you
think it is — check `ollama list`.

## 8. Make your first real AI call

Try **Essay Builder → paste a draft → Review**, or **Materials → add a text
file** (the analysis starts by itself).

**What to expect:** the first call also loads the model into memory, so give it
a couple of minutes; later calls are much faster because Atlas keeps the model
resident for 30 minutes. A deep review of a long draft can take several minutes
on a CPU — that is the reasoning working, and it is why the wait limit is 30
minutes rather than the 5 minutes a normal web request would allow.

If you want to watch it happen, run this in another terminal while Atlas works:

```bash
ollama ps
```

---

## Not enough memory for the model

This is the most common failure on a local setup, and it reads like a bug when
it is arithmetic. Ollama reports it roughly as:

```text
Ollama returned HTTP 500: llama-server reported out-of-memory during startup:
ggml_backend_buft_alloc_buffer_n_default: failed to allocate Vulkan0 buffer of
size 1073741824
llama_init_from_model: failed to initialize the context: failed to allocate
buffer for kv cache
```

Read the last line: **`kv cache`**. Weights and the KV cache are two separate
reservations, so a model can load and still fail to start. The cache is sized
`layers × KV heads × head size × 2 × bytes × context length` and it is reserved
**up front for the whole window** — not for the size of what you happened to
send. So `OLLAMA_NUM_CTX=32768` costs four times what `8192` costs, on every
call, for as long as the model stays loaded.

Work down this list and stop as soon as the call succeeds. Each step gives
something different away, and they stack.

**1. Lower the context window.** This is the only lever that costs your results
nothing, because the reasoning budget Atlas asks for (8192 tokens) still fits
inside a window this size.

```dotenv
# .env.local
OLLAMA_NUM_CTX=8192
```

Restart `npm run dev` — environment files are read at startup. A 16K–32K window
is a comfort for very long documents; it is not required for Atlas to answer
well.

**2. Make the cache smaller instead of shorter** by quantizing it. These belong
to the environment **Ollama itself** runs in — not `.env.local`, because Atlas
never reads them:

```bash
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0
```

`q8_0` roughly halves the KV cache and is very close to lossless at these
lengths; `q4_0` roughly quarters it, and that is where quality can start to
slip. `OLLAMA_KV_CACHE_TYPE` only takes effect with flash attention on, so set
both, then **restart Ollama** (quit the tray app on Windows, or stop
`ollama serve`) — the server reads its environment at startup.

**3. Free memory that is already spoken for.**

```bash
ollama ps               # anything resident that you are not using?
ollama stop qwen3:8b    # unload it now
```

Atlas keeps the model loaded for 30 minutes between calls, because reloading an
8B model on every call is slow. If you would rather have that memory back
between calls:

```dotenv
# .env.local
OLLAMA_KEEP_ALIVE=0
```

Close browsers, games and anything else holding the GPU as well — on a small
card they are competing for the same memory.

**4. Keep part of the model off the GPU.** Ollama normally splits the model
across GPU and system memory itself. If its choice leaves no room for the
cache, override it:

```dotenv
# .env.local
OLLAMA_NUM_GPU=28    # offload 28 layers; 0 = run entirely on the CPU
```

Fewer layers on the GPU means slower generation, but a model that actually
starts. Atlas sends this with every call; leave it unset to let Ollama decide.

**5. Rule out a driver or Ollama regression.** If it still fails at
`OLLAMA_NUM_CTX=4096` with `OLLAMA_NUM_GPU=0`, the model is not the problem.
Update Ollama and your GPU driver; integrated GPUs in particular have open
reports of allocation failures on newer builds (ollama/ollama issues #18531 and
#17748). As a last resort, `ollama pull qwen3:4b` and set
`OLLAMA_MODEL=qwen3:4b` — a smaller model that answers beats a bigger one that
cannot start.

## When something is wrong

| What you see | What it means | What to do |
|---|---|---|
| “Ollama is not running at http://127.0.0.1:11434 (connection refused…)” | The Ollama server is not up. | Open the Ollama app or run `ollama serve`, then press **Re-check**. |
| `Ollama does not have the model "qwen3:8b"` | The model name does not match anything pulled. | `ollama pull qwen3:8b`, or set `OLLAMA_MODEL` to a name from `ollama list`. |
| “The prompt is larger than Ollama's context window” | The document plus instructions did not fit. | Raise `OLLAMA_NUM_CTX` (up to the limit AI setup shows for your model), or send fewer/shorter materials. Atlas never cuts a prompt silently. |
| “Ollama ran out of memory while starting qwen3:8b… failed to allocate buffer for kv cache” (or “model requires more system memory”) | The model loaded, but the KV cache for the context window did not fit in the memory left over. | Work through *Not enough memory for the model* below, in that order. |
| “Ollama did not finish within 30 minute(s)” | Your hardware could not finish that generation in the time allowed. | Send a shorter document, or set `OLLAMA_THINK=off` for a fast, shallower answer. |
| “The model wrote only its reasoning and never reached the answer” | The trace and the answer did not both fit. | Raise `OLLAMA_NUM_CTX`, or send less text. |
| Atlas says “Demo output” | `LLM_PROVIDER=ollama` is missing, or the dev server was started before you created `.env.local`. | Check the file, then **restart `npm run dev`** — environment files are read at startup. |
| Port 5173 is already in use | Another dev server is running. | Close it, or run `npm run dev -- --port 5174`. |
| A PDF will not read | Node is older than 22.13. | `node -v`, then update Node and restart the terminal. |

Two habits that save time:

- **Restart `npm run dev` after editing `.env.local`.** Environment variables are
  read once, at startup.
- **`ollama ps`** shows whether the model is loaded and how much memory it is
  using; **`ollama logs`** (or the Ollama app's log) shows what Ollama saw.

---

## Updating Atlas later

1. In **GitHub Desktop**, select the `Atlas` repository.
2. **Repository → Pull** (or **Fetch origin**, then **Pull** when it offers).
3. If `package.json` changed, run `npm install` again, then `npm run dev`.

Your `.env.local` and your browser-stored data are untouched by a pull.

## Checking the app itself (optional)

These run offline — no model, no browser, no network:

```bash
npm run verify     # the quality rules, the document reader, and the whole Ollama path
npm run lint
npm run typecheck
npm run build
```

`npm run verify` ends with `verify-ollama: ok (38 checks)` — that is the local
provider path, including reasoning, tested against a mock Ollama.

## Where to read more

- **README.md** — what Atlas does, page by page.
- **DEPLOYMENT.md, Part 2.7** — the full reference for every Ollama setting, and
  how reasoning models are handled.
- **DEPLOYMENT.md, Part 4** — local development in general.
- **AGENTS.md** — the rules the codebase holds itself to.
