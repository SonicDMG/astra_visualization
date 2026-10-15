<div align="center">

# 🔭 Astra Data Explorer

**A beautiful, real-time GUI for browsing, querying, and editing your [DataStax Astra DB](https://www.datastax.com/products/datastax-astra) collections.**

[![Next.js](https://img.shields.io/badge/Next.js-16.4-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

![Astra Data Explorer Screenshot](docs/screenshot.png)

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🗂 **Keyspace & Collection Browser** | Navigate all your Astra keyspaces and collections from a collapsible sidebar. Capability badges call out **Vector**, **Vectorize**, **Lexical**, and **Rerank** collections at a glance. |
| 🔍 **Multi-mode Search** | Switch between **Browse** (paginated scan), **Vector Similarity** (ANN search with score), **Lexical** (full-text BM25), and **Hybrid** (vector + lexical fusion) — automatically offered only when the collection supports them. |
| 🧩 **Visual Filter Builder** | Build `$and` / `$or` filter trees with a point-and-click UI. Every clause is shown as a readable chip; no JSON required. |
| 📊 **Virtualized Results Grid** | Handles large documents with a column-resizable, sort-clickable, horizontally scrollable data grid powered by TanStack Table and TanStack Virtual. |
| ✏️ **Inline Field Editing** | Click any cell in the row detail panel to edit scalar and JSON fields in place, with datatype validation, optimistic UI, and full live-trace support. |
| 🔬 **Live Request Trace** | Every query opens a real-time architecture diagram — animated swimlanes across Browser → App Server → Astra Data API — showing exactly how the request was routed, how long each step took, and the raw Data API JSON. |
| 🌓 **Dark / Light Theme** | Smooth system-aware theme toggle with a coherent design token system throughout. |
| 🔗 **Deep-linkable State** | The current keyspace, collection, search mode, filter, sort, and page are all encoded in the URL — share or bookmark any view. |

---

## 🖥 Demo

> **Coming soon** — deploy your own instance in under 2 minutes using the guide below.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ (or [Bun](https://bun.sh/))
- **pnpm** 11+ → `npm install -g pnpm`
- A [DataStax Astra DB](https://astra.datastax.com/) database (free tier works)

### 1 — Clone & Install

```bash
git clone https://github.com/SonicDMG/astra_visualization.git
cd astra_visualization
pnpm install
```

### 2 — Configure Environment

Copy the example env file and fill in your Astra credentials:

```bash
cp .env.example .env.local
```

Open `.env.local` and set the two required values:

```env
# Your Astra DB Data API endpoint
# Format: https://<database-id>-<region>.apps.astra.datastax.com
ASTRA_DB_API_ENDPOINT=https://<database-id>-<region>.apps.astra.datastax.com

# Application token from Astra Portal → Settings → Tokens
ASTRA_DB_APPLICATION_TOKEN=AstraCS:<your-token-here>
```

> ⚠️ **Never commit `.env.local`** — it is already git-ignored.

### 3 — Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🏗 Architecture

```
astra_visualization/
├── app/
│   ├── page.tsx               # Root shell — sidebar + header + main
│   └── api/
│       ├── keyspaces/         # GET  /api/keyspaces
│       ├── collections/       # GET  /api/collections?keyspace=
│       ├── query/             # POST /api/query
│       ├── count/             # POST /api/count
│       └── update/            # POST /api/update
├── components/
│   ├── Sidebar.tsx            # Keyspace picker + collection list
│   ├── ExplorerState.tsx      # All query state, paging, search modes
│   ├── ResultsGrid.tsx        # Virtualized TanStack Table grid
│   ├── FilterBuilder.tsx      # Visual filter-tree editor
│   ├── SearchBar.tsx          # Mode switcher + search input
│   ├── RowDetailPanel.tsx     # Slide-in document detail + inline edit
│   ├── FieldEditor.tsx        # Per-field edit form with type validation
│   ├── LiveTracePanel.tsx     # Resizable trace panel with raw JSON
│   ├── QueryFlowDiagram.tsx   # Animated SVG swimlane architecture diagram
│   ├── ThemeToggle.tsx        # Dark/light mode toggle
│   └── ConfigErrorScreen.tsx  # Startup error UI (missing env vars)
└── lib/
    ├── astra/                 # Astra DB gateway + schema helpers
    └── trace/                 # Live trace context + types
```

### Data Flow

```
Browser (React)
    │  fetch /api/query
    ▼
Next.js API Route (server-only)
    │  @datastax/astra-db-ts
    ▼
Astra Data API (HTTPS)
    │
    ▼
JSON documents → virtualized grid
```

All Astra credentials stay on the server. The browser never sees your token.

---

## 🔬 Live Request Trace

Click **Live Trace** in the header to open the trace panel. Every query emits a step-by-step walkthrough:

1. **Browser** — user action (search, filter change, page turn)
2. **App Server** — Next.js route handler validates and translates the request
3. **Astra Data API** — the actual Data API call with method, endpoint, and round-trip time

The animated **Query Flow Diagram** draws a swimlane architecture diagram in real time, colour-coding each step by its type (frontend / backend / database / cloud / security). Click any card to inspect the raw request/response JSON.

---

## 🗄 Supported Collection Types

| Badge | Capability | Search Modes Available |
|---|---|---|
| 🔵 **Vector** | Native `$vector` field + ANN index | Browse, Vector Similarity |
| 🟣 **Vectorize** | Auto-embedding via a cloud model | Browse, Vector Similarity (text query) |
| 🟢 **Lexical** | BM25 full-text index | Browse, Lexical |
| 🟠 **Rerank** | Cross-encoder re-ranking | Browse, Hybrid |
| _(none)_ | Standard JSON collection | Browse only |

---

## 🛠 Development

```bash
# Start dev server with Turbopack
pnpm dev

# Type-check
pnpm typecheck

# Lint
pnpm lint

# Production build
pnpm build
pnpm start
```

---

## 🚢 Deploy to Vercel

The fastest way to deploy:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSonicDMG%2Fastra_visualization)

Set the two environment variables (`ASTRA_DB_API_ENDPOINT` and `ASTRA_DB_APPLICATION_TOKEN`) in the Vercel project settings, and you're live.

---

## 🤝 Contributing

Contributions are welcome! Please open an issue to discuss your idea before sending a pull request.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit your changes: `git commit -m "feat: add my feature"`
4. Push to the branch: `git push origin feat/my-feature`
5. Open a Pull Request

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with ❤️ using [Next.js](https://nextjs.org/), [Tailwind CSS](https://tailwindcss.com/), [TanStack Table](https://tanstack.com/table), and the [DataStax Astra TypeScript SDK](https://github.com/datastax/astra-db-ts).

</div>
