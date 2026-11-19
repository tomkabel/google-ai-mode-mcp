<div align="center">

# Google AI Mode MCP Server ⚡

### Plug **any** LLM into Google's AI Mode for free, cited, token-efficient web research

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-1.0%2B-00b894?logo=modelcontextprotocol&logoColor=white)](https://modelcontextprotocol.io/)
[![npm](https://img.shields.io/npm/v/google-ai-mode-mcp.svg?logo=npm&logoColor=cb3837)](https://www.npmjs.com/package/google-ai-mode-mcp)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Fork of PleasePrompto/google-ai-mode-mcp](https://img.shields.io/badge/fork-PleasePrompto%2Fgoogle--ai--mode--mcp-8e7cc3)](https://github.com/PleasePrompto/google-ai-mode-mcp)

**Claude Code · Cursor · Codex · Cline · Windsurf · Zed · VS Code · any MCP client**

> Your agent reads 10 links and burns thousands of tokens synthesizing them.
> This server asks Google AI Mode to do the synthesis and hands your agent
> **one clean, cited Markdown answer** instead.

[Installation](#-installation) · [Fork Highlights](#-whats-new-in-this-fork) · [Quick Start](#-quick-start) · [How It Works](#-how-it-works) · [Tool Reference](#-tool-reference) · [FAQ](#-faq)

</div>

---

## ✨ What's New in This Fork

This fork hardens the original server for **reliability** and
extends its reach to **more languages**. Every change is battle-tested and
backward-compatible — drop-in for existing setups.

| Enhancement | What it fixes | Impact |
| --- | --- | --- |
| 🕵️ **Matching user agent** | The old UA was hardcoded to a Chrome build that drifted from the real browser, a dead-giveaway bot tell. | UA is now **probed from the actually installed Chrome** (once, cached), so `navigator.platform`, `buildID`, and UA always agree. Fewer CAPTCHAs. |
| 🧊 **Cold-profile warm-up** | A fresh profile deep-linking straight to `/search?udm=50` looked like a bot (no cookies/history). | Lands on `google.com` first to set consent/session cookies, then searches. **Best-effort & guarded** — a warm-up failure can never abort your search. |
| 🎯 **Bulletproof completion detection** | A transient >1s stream stall could be mistaken for "done", returning a truncated answer. | 4-stage detection (SVG → aria-label → multilingual text → **content-stability**) now requires **3 consecutive stable polls** before declaring completion. No more false positives, no more half answers. |
| 🌐 **Estonian (`et`) support** | Estonian locales had no citation/completion/availability handling. | Full `et` coverage across citation selectors, completion indicators, cutoff markers, availability checks, and CAPTCHA text. |
| 🚨 **Fail loud** | Every failure path returned `success: true` with an empty or sourceless answer, so the calling LLM hallucinated over the gap. | Results carry `status: "ok" \| "degraded" \| "failed"`, an `errorCode` and `warnings[]`. Under 200 chars of answer is `failed` + MCP `isError`; citations without parsable sources or a timed-out completion are `degraded` with a warning you can branch on. |
| 🆕 **Current Google icon selector** | The completion "thumbs-up" SVG selector had gone stale. | Updated to the current Material icon `viewBox="0 0 24 24"`; removed the overly-generic Estonian text indicator that caused premature completion. |

**Net effect:** more answers complete correctly on the first try, fewer CAPTCHAs,
cleaner citations, a wider language net, and failures you can actually see.

---

## 💡 What This Is

An [MCP](https://modelcontextprotocol.io/) server that connects your code agent
(Claude, Cursor, Codex, Cline, Windsurf, Zed, VS Code, …) to **Google AI Mode** —
Google's AI-powered search that synthesizes information from dozens of web sources
into a single, cited answer.

Instead of your agent scraping page after page, **Google does the heavy lifting**
and your agent receives one clean, structured Markdown response with inline
citations.

- ✅ **Free** — uses public Google Search, no API keys or subscriptions.
- 🪙 **Token-efficient** — one synthesized answer instead of 10 raw pages.
- 🔗 **Grounded** — every claim carries a source link you can verify.
- 🤖 **Stealthy** — Patchright-powered anti-detection with an adaptive fingerprint.

---

## 🚀 Why It Matters

Google AI Mode (`udm=50`) turns Search into a research assistant: it reads and
analyzes dozens of websites, synthesizes the findings into a structured answer,
and cites every claim with source links. Your agent gets all the benefit without
doing the work — or burning the tokens.

<details>
<summary><b>See it vs. traditional web research</b></summary>

**Traditional web research**
- Agent searches Google → gets 10 links
- Agent reads 5–10 full pages → thousands of tokens consumed
- Agent synthesizes manually → risks missing details or hallucinating
- You pay for all those tokens

**With this server**
- Google AI Mode searches **and** synthesizes → one request
- Your agent receives one clean, cited answer → minimal tokens
- Google's sources are preserved → verifiable, grounded
- It's free (uses public Google Search)

</details>

**Example queries an agent can answer:**
```
"Next.js 15 App Router best practices 2026 with server components examples"
→ AI-synthesized coding guide with inline citations [1][2][3]

"Compare PostgreSQL vs MySQL JSON performance 2026, include benchmarks"
→ Technical comparison table with real-world data

"Find the latest EU AI regulations 2026 and their impact on startups"
→ Legal overview with official government sources

"Best noise-cancelling headphones under €300, compare Sony vs Bose"
→ Product comparison with reviews and specs

"Intermittent fasting protocols 2026, include recent scientific studies"
→ Health guide with medical research citations
```

Research on **any** topic — coding, tech comparisons, regulations, product
reviews, health, finance, travel — curated answers with sources, in any of the
supported locales (EN, DE, NL, ES, FR, IT, **ET**).

---

## 📦 Installation

Works with any MCP-compatible client. Pick your setup:

**Claude Code**
```bash
claude mcp add google-ai-search npx google-ai-mode-mcp@latest
```

**Codex**
```bash
codex mcp add google-ai-search -- npx google-ai-mode-mcp@latest
```

**Cline**
```bash
cline mcp add google-ai-search -- npx google-ai-mode-mcp@latest
```

**Gemini**
```bash
gemini mcp add google-ai-mode npx -y google-ai-mode-mcp@latest --scope user
```

**VS Code**
```bash
code --add-mcp '{"name":"google-ai-search","command":"npx","args":["google-ai-mode-mcp@latest"]}'
```

**Hermes Agent** — add to `~/.hermes/config.yaml` under `mcp_servers:`:
```yaml
mcp_servers:
  google-ai-search:
    command: npx
    args: ["google-ai-mode-mcp@latest"]
    connect_timeout: 45.0
    enabled: true
```

**pi** (no built-in MCP client; this repo ships a pi extension that bridges it)
```bash
git clone https://github.com/tomkabel/google-ai-mode-mcp && cd google-ai-mode-mcp
npm install && npm run build
pi install "$PWD"        # registers extensions/google-ai-search.ts → `search_ai` tool
```

**Cursor, Windsurf, Zed, or any other MCP client** — add to your config file:

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "npx",
      "args": ["google-ai-mode-mcp@latest"]
    }
  }
}
```

> Cursor uses `~/.cursor/mcp.json`; Windsurf and Zed have their own settings files.
> Check your client's docs for the config location.

**Linux / WSL on a headless host (Codex, Docker, SSH)?** If you hit a
"Missing X-Server" error when the browser must appear for CAPTCHA solving, wrap
it with `xvfb-run`:

```json
{
  "mcpServers": {
    "google-ai-search": {
      "command": "xvfb-run",
      "args": ["-a", "npx", "google-ai-mode-mcp@latest"]
    }
  }
}
```

```bash
sudo apt-get install xvfb   # if needed
```

---

## ⚡ Quick Start

Just ask your agent naturally:

```
"Search Google AI Mode for: Next.js 15 App Router best practices"
"What are the new features in Astro 4.0?"
"Research React Server Components and save the results"
```

The agent automatically invokes the MCP server, queries Google AI Mode, and
returns a clean, cited answer.

**Save results to a file:**

```
"Search for TypeScript 5.4 features and save it"
```

Files land in platform-specific locations:
- **Linux**: `~/.local/share/google-ai-mode-mcp/results/`
- **macOS**: `~/Library/Application Support/google-ai-mode-mcp/results/`
- **Windows**: `%LOCALAPPDATA%\google-ai-mode-mcp\results\`

Filename pattern: `2026-01-04_15-30-45_typescript_5_4.md`

---

## 🔐 First Run: CAPTCHA Handling

**Headless Chrome is CAPTCHA-bait on many residential IPs.** In our probes a
headless navigation landed on `/sorry` immediately, cold *and* warm profile,
while the same profile in a visible window succeeded. So the default is:

1. First search tries headless (`GOOGLE_AI_HEADLESS=true`).
2. If that lands on a CAPTCHA, the server writes a `headless-blocked` flag
   into the profile dir (24 h TTL) and opens a **visible** browser.
3. Solve the CAPTCHA in that window; the server continues automatically.
4. Every search for the next 24 h goes straight to the visible browser —
   no wasted headless attempt. Pass `headless: true` explicitly to force it.

If your host has no display, run the server under `xvfb-run` (see
Installation). The persistent profile (cookies, consent, history) is the single
most valuable anti-CAPTCHA asset; the server never wipes it.

---

## 🛠 How It Works

```
Your agent asks a question
        ↓
Server launches Patchright Chrome with a persistent profile
        ↓
Google AI Mode searches & synthesizes dozens of sources
        ↓
Server waits for completion (4-stage, content-stable detection)
        ↓
Extracts the AI answer + citations (missing sources → status "degraded")
        ↓
Converts to clean Markdown with [1][2][3] references
        ↓
Your agent receives the final answer (optionally saved to .md)
```

---

## 🧰 Tool Reference

The server exposes a single tool: **`search_ai`**

| Parameter | Required | Default | Description |
| --- | --- | --- | --- |
| `query` | ✅ | — | Your search question |
| `headless` | — | `true` | Run the browser invisibly |
| `timeout_ms` | — | `30000` | Navigation / completion / extraction timeout in ms |
| `resolve_source_urls` | — | `true` | Follow Google `/goto?url=` redirects to publisher URLs (~0.5 s) |
| `save_to_file` | — | `false` | Save result to a `.md` file |
| `filename` | — | auto | Custom filename (without `.md`) |

**Returns**
```json
{
  "success": true,
  "status": "ok",
  "warnings": [],
  "markdown": "<<<UNTRUSTED_WEB_CONTENT id=3f6c2a9e-8b1d-4c57-9e0a-5d7b2f4c1a86>>>\n# AI response with citations [1][2]\n\nSources:\n[1] Title  \nhttps://example.com\n<<<END_UNTRUSTED_WEB_CONTENT id=3f6c2a9e-8b1d-4c57-9e0a-5d7b2f4c1a86>>>",
  "sources": [
    { "title": "Source Title", "url": "https://example.com", "domain": "example.com" }
  ],
  "query": "Your query",
  "savedTo": "/path/to/results/file.md"
}
```

| `status` | Meaning |
| --- | --- |
| `ok` | Full answer, sources parsed, completion signal seen |
| `degraded` | Usable, but read `warnings[]`: citations without parsable sources (selector drift) or completion timed out (answer may be truncated) |
| `failed` | `errorCode` is one of `EMPTY_QUERY`, `EXTRACTION_EMPTY`, `AI_MODE_UNAVAILABLE`, `CAPTCHA_REQUIRED`, `INTERNAL_ERROR`; MCP `isError` is set; `markdown` is empty |

`markdown` is scraped web text. It is wrapped in `<<<UNTRUSTED_WEB_CONTENT id=…>>>`
… `<<<END_UNTRUSTED_WEB_CONTENT id=…>>>` delimiters so the calling model can
treat it as data, not instructions. The id is random per response: only the END
marker with the opening marker's id closes the fence, and any marker inside with
a missing or different id is page text. The saved `.md` file is unwrapped.

**Examples**
```javascript
// Basic search
{ "query": "Rust async patterns 2026" }

// Save to file
{ "query": "Next.js 15 features", "save_to_file": true, "filename": "nextjs-15-guide" }

// Visible browser (CAPTCHA / debugging)
{ "query": "PostgreSQL optimization", "headless": false }
```

---

## 🎛 Configuration (Optional)

Works out of the box. Advanced users can tune behaviour via environment variables
(see `.env.example` for the full list):

```bash
# Browser
export GOOGLE_AI_HEADLESS=true            # Run browser invisibly
export GOOGLE_AI_IDLE_TIMEOUT_MS=600000   # Close idle browser after 10 min (0 = keep open)

# Timeouts
export GOOGLE_AI_RESPONSE_TIMEOUT=30000   # 30s to get the AI response
export GOOGLE_AI_CAPTCHA_TIMEOUT=300000   # 5 min to solve a CAPTCHA

# CAPTCHA handling
export GOOGLE_AI_CAPTCHA_POLL_INTERVAL=3000
export GOOGLE_AI_CAPTCHA_MAX_CONSECUTIVE=3
export GOOGLE_AI_CAPTCHA_COOLDOWN_MS=30000
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_AI_HEADLESS` | `true` | Invisible browser |
| `GOOGLE_AI_BROWSER_TIMEOUT` | `30000` | Browser nav timeout (ms) |
| `GOOGLE_AI_IDLE_TIMEOUT_MS` | `600000` | Close idle browser after N ms (0 = keep open) |
| `GOOGLE_AI_CAPTCHA_TIMEOUT` | `300000` | CAPTCHA timeout (ms) |
| `GOOGLE_AI_CAPTCHA_POLL_INTERVAL` | `3000` | How often to check whether the CAPTCHA was solved (ms) |
| `GOOGLE_AI_CAPTCHA_MAX_CONSECUTIVE` | `3` | Restart after N CAPTCHAs |
| `GOOGLE_AI_CAPTCHA_COOLDOWN_MS` | `30000` | Cooldown after restart (ms) |
| `GOOGLE_AI_RESPONSE_TIMEOUT` | `30000` | Search response timeout (ms) |
| `GOOGLE_AI_RESOLVE_SOURCE_URLS` | `true` | Follow `/goto?url=` redirects to publisher URLs |
| `GOOGLE_AI_PROFILE_DIR` | auto | Custom browser profile dir |

---

## ♻️ Process lifecycle

- **Shared, persistent browser.** A single Chrome context is reused across searches instead of relaunching per request.
- **Closes when idle.** After `GOOGLE_AI_IDLE_TIMEOUT_MS` of no open pages the browser closes on its own; the next search relaunches it. The idle timer only arms when no search is in flight, so a long CAPTCHA wait is never cut short. Set to `0` to keep the browser open forever.
- **Exits with its host.** When the MCP host disconnects (stdin EOF), the server shuts down and its Chrome tree is reaped — no orphaned browser processes.

---

## 🩺 Troubleshooting

**Repeated CAPTCHAs**
- Ask your agent: *"Use visible browser for this search"*
- Add 10–30s delays between searches
- After 3 consecutive CAPTCHAs the server closes and relaunches the browser with an exponential, jittered cooldown (30 s, 60 s, 120 s … capped at 4 min). The profile is kept.
- Delete `<profile dir>/headless-blocked` to let headless try again before the 24 h TTL expires

**Browser won't launch**
```bash
# Linux / macOS
rm -rf ~/.local/share/google-ai-mode-mcp/chrome_profile

# Windows
rmdir /s "%LOCALAPPDATA%\google-ai-mode-mcp\chrome_profile"
```

**Wrong-language results**
The server forces English (`en-US`) results by default. If you still get
unexpected languages, clear the profile (above).

**Missing citations**
Citation extraction now retries once with an explicit source request. If you
still see none, update to the latest build:
```bash
npm update -g google-ai-mode-mcp
```

---

## 💎 Tips for Better Results

- **Be specific:** *"React hooks best practices 2026 (useState, useEffect, custom hooks)"* beats *"React hooks"*.
- **Include versions:** *"Next.js 15 new features and breaking changes"*.
- **Request structure:** *"Compare PostgreSQL vs MySQL 2026 with a performance comparison table"*.
- **Ask for examples:** *"Show TypeScript discriminated union examples with type narrowing"*.

---

## ❓ FAQ

**Does this work with my code agent?** Yes — any MCP-compatible client.

**Is it free?** Yes. Open source (MIT), and it uses public Google Search. No API keys or subscriptions.

**How accurate are results?** They come from Google's AI Mode, which cites sources for every claim. Always verify critical details via the linked sources.

**What about privacy?** Everything runs locally. The browser profile stays on your machine; no credentials or external services beyond Google Search.

**Can I watch the browser?** Yes — set `headless: false` in the tool call, or ask your agent to use visible mode.

**Why not just use regular web search?** Regular search returns links; your agent then reads 5–10 pages and burns thousands of tokens. This server lets Google do the synthesis, so your agent gets one clean answer for minimal token cost.

---

## 👩‍💻 Development

Clone, install, and run from source:

```bash
git clone https://github.com/tomkabel/google-ai-mode-mcp.git
cd google-ai-mode-mcp
npm install
npm run build

# Typecheck + unit tests (no browser)
npm run check

# Live smoke test against real Google (needs a display or xvfb-run; asserts and exits non-zero)
npm run smoke -- "your query"

# Continuous build
npm run watch
```

> `npm run dev` (tsx) breaks `page.evaluate` bodies with `__name is not defined`
> because esbuild's `keepNames` injects a helper the browser never sees. Live
> runs use `npm run build && node dist/index.js`.

---

## ⚠️ Important Notes

**CAPTCHA handling:** Google may show a CAPTCHA on first use or under heavy
searching. Ask your agent to show the browser (*"switch to visible mode"*), solve
it once, and you're usually set for future searches.

**Responsible use:** This tool automates browser interactions with Google Search.
Use it responsibly and respect Google's Terms of Service; add delays between heavy
search sessions if needed.

**Verification:** Results come from Google's AI Mode with source citations, but
always verify critical information via the linked sources. This is a research
tool, not a source of truth.

---

## 🙏 Credits & License

- **Fork maintained by** [@tomkabel](https://github.com/tomkabel).
- **Original project & concept** by [Gérôme Dexheimer](https://github.com/PleasePrompto) — [PleasePrompto/google-ai-mode-mcp](https://github.com/PleasePrompto/google-ai-mode-mcp).
- **License:** MIT — see [LICENSE](LICENSE).

Found an issue or want to contribute? Open a
[GitHub Issue](https://github.com/tomkabel/google-ai-mode-mcp/issues) or send a
pull request — both are welcome.

---

<p align="center"><sub>Built with stability and a healthy respect for Google's rate limits.</sub></p>
