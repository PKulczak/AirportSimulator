# Airport Modelling Group 2

A full-stack tool for simulating airport runway operations. Configure a simulation
(arrival/departure rates, duration, max wait time, aircraft speed, which runways are
available and in what mode, whether random runway closures are enabled), and the backend
generates synthetic aircraft traffic and runs a discrete-event simulation that queues
aircraft for runways, escalates priority for emergencies and low fuel, applies random
runway closures, and records the outcome of every aircraft (success, diversion,
cancellation). The frontend lets you create simulations, browse simulation history, view
aggregate metrics for a completed run, and replay a full animated visualisation of the
run (runway occupancy, queues, emergencies, closures) over time.

For the full behavioural spec — scheduling, fuel/emergency modelling, priority rules,
output metrics — see [SPEC.md](SPEC.md).

## Project structure

Two independent apps, developed together:

- [`backend/`](backend/) — Django + Django REST Framework API, a [SimPy](https://simpy.readthedocs.io/)-based
  discrete-event simulation engine, a `dramatiq`/Redis async task queue, Postgres.
- [`frontend/`](frontend/) — React 19 + TypeScript single-page app built with Vite, using
  PrimeReact components and Tailwind v4 for styling.

## Prerequisites

- Python 3 and Node.js
- PostgreSQL (default local database name: `airportdb`)
- Redis (used as the `dramatiq` task queue broker)

## Getting started

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in DB/Redis vars for your local setup
python manage.py migrate
python manage.py runserver          # API at http://localhost:8000
```

In a **separate terminal**, run the task queue worker — this is required for any created
simulation to actually execute:

```bash
cd backend
python manage.py rundramatiq
```

### Frontend

```bash
cd frontend
echo "VITE_API_BASE_URL=http://localhost:8000" > .env.local
npm install
npm run dev                         # dev server at http://localhost:3000
```

## Running tests

```bash
cd backend
pytest                              # full backend suite (sqlite in-memory DB, stub broker)
```

```bash
cd frontend
npm run lint                        # ESLint over the whole project
```

There is no frontend test runner configured (no Jest/Vitest, no test files) — frontend
changes are verified via type-checking (`npm run build`), linting, and manual testing in
the browser.

## Notes

- The `rundramatiq` worker must be restarted manually to pick up code changes to the
  simulation engine or task definitions — it doesn't hot-reload like `runserver` does.
- There's no websocket/push mechanism: simulation status is only observable by
  re-fetching from the API, and the history/detail/visualisation pages don't
  auto-refresh while a simulation is still running.
- [CLAUDE.md](CLAUDE.md) documents this repo's conventions and dev-process quirks for
  AI coding agents (e.g. Claude Code) working in it — not needed for manual development,
  but useful if you're using one.
