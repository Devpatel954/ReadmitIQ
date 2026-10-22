#!/usr/bin/env bash
# Starts the FastAPI backend (port 8077) and the React dev server.
set -e
cd "$(dirname "$0")"
[ -d backend/.venv ] || { python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt; }
[ -d frontend/node_modules ] || (cd frontend && npm install)
(cd backend && .venv/bin/uvicorn app.main:app --port 8077) &
API=$!
trap "kill $API" EXIT
cd frontend && API_URL=http://localhost:8077 npm run dev
