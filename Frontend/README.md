# Astra Tool Registry frontend

React + TypeScript + Vite interface for the PostgreSQL-backed registry in `../Backend`.

## Start locally

1. Start the backend and PostgreSQL using the steps in [`../Backend/README.md`](../Backend/README.md).
2. From this folder, run `npm install` and `npm run dev`.
3. Open the Vite URL and enter the backend API URL (normally `http://localhost:3000`) and the `REGISTRY_ADMIN_TOKEN` from the backend environment.

The admin token is held in `sessionStorage` for the current browser session. The backend enables CORS for the frontend origin and still requires its admin bearer token on protected routes.

## Build

Run `npm run build` to type-check the app and create a production bundle in `dist/`.

## Registry workspace

The sidebar groups **Tools** under **Registries**, leaving room for other registry types. Tool registry sections cover the HTTP/MCP catalog, MCP connections, authentication profiles, agent and group permissions, approvals, and sanitized execution/audit history.
