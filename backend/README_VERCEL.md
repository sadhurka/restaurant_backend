# Deploying this backend to Vercel (quick notes)

This backend was originally an Express app. For Vercel we provide small serverless endpoints under `api/`.

What I added
- `api/index.js` — simple health endpoint (`/api`)
- `api/menu.js` — replicates the logic from `server.js` to read `data/menu.json` and return formatted items

Important notes before deploy
1. Static images
   - Images live in `images/` in this repo. During Vercel builds the project runs a small copy script that moves files from `images/` -> `public/images/` so they become available at `/images/<name>`.
   - The copy runs via the `build` script (Vercel will run `npm run build`). If you run locally and want to test this step, run:

     ```powershell
     # from backend/ directory
     npm run build
     # then you should see files under public\images
     dir public\images
     ```

2. Ensure `data/menu.json` is present (it is read by `api/menu.js`).

Deploy options
- Using the Vercel CLI:

  ```powershell
  # from backend/ directory
  npm install
  npx vercel login    # first time
  npx vercel         # follow prompts, set root to backend if deploying from repo root
  ```

- Or connect the Git repository in the Vercel dashboard and set the project root to `backend/`.

Local testing
- To emulate Vercel locally, install the Vercel CLI and run:

  ```powershell
  npx vercel dev
  ```

Notes
- The existing Express `server.js` is left intact for local development. `package.json` still has `start`/`dev` scripts for running locally.
- If you prefer not to convert to serverless, consider deploying the Express server to Render, Railway, Fly, or another host that supports a long-running Node process.

If you want, I can:
- Move or copy `images/` into `public/images` for you (but I can't copy binary images unless they're in the repo). I can create the folder and update configuration.
- Add more API endpoints or adapt the frontend to call `/api/menu`.
