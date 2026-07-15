# RecomAI

RecomAI is a local shopping recommendation application. It analyzes a buyer's purchase history with Ollama, selects an eligible catalog category, ranks matching products, and lets the user complete a simulated purchase. Completed purchases are stored in local JSON memory and appear in the application's buyer, history, and analytics views.

![RecomAI dashboard](docs/screenshots/dashboard.png)

## Features

- Four buyer input modes: guided form, pasted JSON, JSON file upload, and sample buyer
- Local Ollama recommendations with a structured category and natural-language reason
- Category validation and one retry when model output does not meet the application rules
- Up to three catalog matches ranked by distance from the buyer's historical mean purchase price
- Engineering confidence and per-product price-match scores
- Explicit manual purchase step; generating a recommendation does not update memory
- Buyer summaries, pinned profiles, purchase history search/filtering, JSON/CSV exports, and interaction deletion
- Spending and category charts built from known purchase history and recorded interactions
- Product comparison using the local catalog and bundled product artwork
- Responsive browser interface with light, dark, and system themes

## Technology

| Area | Implementation |
| --- | --- |
| Frontend | React, Vite, React Router, Recharts, Framer Motion, Tailwind CSS, Sonner, Lucide icons |
| Backend | FastAPI, Pydantic, Uvicorn |
| AI integration | Ollama chat API using structured JSON output |
| Persistence | Local JSON repositories with atomic memory-file replacement |
| Tests | pytest, FastAPI TestClient, Vitest, Testing Library, jsdom |

## Recommendation and purchase workflow

1. The frontend submits a buyer profile through the JSON body or upload endpoint.
2. Persisted purchases for the same buyer ID are merged into the submitted history.
3. The Ollama agent receives the recalled history and eligible local catalog categories, then returns a category and reason as structured JSON.
4. The backend validates the category and reasoning. Invalid model output is retried once.
5. Matching catalog products are ranked by distance from the buyer's historical mean price, with at most three returned.
6. The user selects one ranked product in a separate purchase request.
7. The backend revalidates the product against the current catalog, creates a simulated transaction, and atomically updates `memory.json`.

Recommendation generation is read-only. Memory changes only after a manual purchase or history deletion.

## Application pages

| Path | Purpose |
| --- | --- |
| `/` | Purchase KPIs, latest recorded purchase, and workflow overview |
| `/recommend` | Buyer input, recommendation reasoning, ranked products, comparison, and simulated purchase |
| `/buyers` | Searchable buyer summaries, spending statistics, and browser-local pins |
| `/analytics` | Purchase totals, dated transaction spending, and category distribution |
| `/history` | Search, filter, sort, export, and delete recorded interactions |
| `/settings` | Theme preference and local system/model information |

## Screenshots

| Recommendation workspace | Purchase analytics |
| --- | --- |
| ![Recommendation workspace](docs/screenshots/recommendation.png) | ![Purchase analytics](docs/screenshots/analytics.png) |

## Local setup

### Prerequisites

- Python with `pip`
- Node.js with `npm`
- [Ollama](https://ollama.com/) and its CLI available on `PATH`

The repository does not declare or enforce minimum Python or Node.js versions.

### Install and run

From the repository root:

```powershell
ollama pull qwen2.5:3b
python -m pip install -r backend/requirements.txt
cd frontend
npm install
cd ..
python run.py
```

Open `http://127.0.0.1:5173`.

The launcher checks the backend packages, frontend dependencies, Ollama CLI, and selected model. It starts the local Ollama service when port `11434` is not already open, then starts FastAPI on `127.0.0.1:8000` and Vite on `127.0.0.1:5173`.

To check prerequisites without starting services:

```powershell
python run.py --check
```

### Manual development

Run Ollama separately, then start the backend and frontend in separate terminals:

```powershell
# Terminal 1
cd backend
uvicorn app.main:app --reload
```

```powershell
# Terminal 2
cd frontend
npm run dev
```

## Configuration

The backend reads configuration directly from the process environment. The repository does not include a dotenv loader or require secrets.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_DIR` | `backend/data` | Directory containing `catalog.json`, `sample_buyers.json`, and `memory.json` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Base URL used by the backend for Ollama tags and chat requests |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Ollama model used for recommendations and launcher model checks |
| `MAX_UPLOAD_BYTES` | `1000000` | Maximum accepted buyer JSON upload size in bytes |

Set overrides in the shell before starting the application. The root launcher manages Ollama only on the default local port `11434`; use the manual development commands when connecting the backend to a custom `OLLAMA_URL`.

## API

FastAPI serves the backend at `http://127.0.0.1:8000`. Interactive OpenAPI documentation is available at `/docs` while the backend is running.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sample-buyers` | Return sample buyers with any persisted purchases recalled |
| `GET` | `/api/buyers` | Return merged sample and persisted buyer summaries |
| `GET` | `/api/history` | Return normalized persisted recommendation/purchase interactions |
| `GET` | `/api/system-info` | Return application version, model readiness, and local memory information |
| `DELETE` | `/api/history/{user_id}/{transaction_id}` | Delete one interaction and rebuild or remove the latest buyer memory snapshot |
| `POST` | `/api/shopping/process` | Validate a buyer JSON body and generate a recommendation |
| `POST` | `/api/shopping/upload` | Validate an uploaded buyer JSON file and generate a recommendation |
| `POST` | `/api/shopping/purchase` | Purchase one product from the submitted ranked recommendation context |

The process and upload endpoints return the recalled buyer, recommendation, ranked products, metrics, and warnings without creating a transaction. The purchase endpoint returns the selected catalog product, simulated transaction, and updated memory snapshot.

### Error responses

- `422`: invalid buyer data, upload, or purchase selection
- `413`: upload exceeds `MAX_UPLOAD_BYTES`
- `502`: Ollama returned invalid recommendation output after retry
- `503`: Ollama could not be reached or run the selected model
- `404`: matching products or a requested history interaction were not found
- `500`: required local JSON data is missing, corrupt, or cannot be updated

## Data and persistence

The backend uses three JSON files under `backend/data`:

- `catalog.json` contains the local product catalog.
- `sample_buyers.json` contains starter buyer profiles.
- `memory.json` contains completed simulated purchases and interaction history.

Memory writes use a temporary file followed by `os.replace`, guarded by an in-process lock for each memory path. This protects individual writes within one backend process. The project does not use a relational database or support multi-worker transactional storage.

## Project structure

```text
backend/
  app/                  FastAPI routes, models, agents, orchestration, and JSON repositories
  data/                 Product catalog, sample buyers, and mutable local memory
  tests/                Backend workflow, validation, failure, and persistence tests
  requirements.txt      Backend runtime and test dependencies
frontend/
  public/products/      Product artwork addressed by catalog product ID
  src/components/       Application shell, buyer input, workflow result, and shared UI
  src/context/          Shared application data and browser preference state
  src/pages/            Six lazy-loaded application pages
  package.json          Frontend dependencies and dev/test/build scripts
  vite.config.js        React, Tailwind, API proxy, and Vitest configuration
docs/screenshots/       Current Dashboard, Recommend, and Analytics captures
run.py                  Local prerequisite checker and process launcher
```

## Validation

From the repository root, run the backend tests:

```powershell
python -m pytest -q backend
```

Then run the frontend tests and production build:

```powershell
cd frontend
npm run test
npm run build
```

Backend tests replace Ollama with deterministic test agents. The repository does not configure linting, static type checking, Docker, or CI workflows.

## Scope

- RecomAI is intended for local development and demonstration.
- Purchases are simulated; there is no payment processing or inventory mutation.
- There is no authentication, authorization, user-account system, workspace isolation, or admin dashboard.
- The application is a responsive web interface.
- Ollama is the only external runtime integration.
- JSON memory is used for the current single-process local workflow.
