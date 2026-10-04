# Tasks — Todo List Web App

A production-ready todo list application:

- **Frontend:** HTML5 + CSS3 + vanilla JavaScript (ES6+), hosted free on GitHub Pages
- **Backend:** Google Apps Script Web App, deployed as a REST-style JSON API
- **Database:** Google Sheets
- **Timezone:** Asia/Kolkata (all server timestamps are generated in this timezone)

No frameworks, no build step, no paid services.

---

## 1. How it's structured

```
todo-app/
├── index.html          # App shell / markup
├── css/
│   └── style.css       # All styling, responsive + accessible
├── js/
│   ├── api.js           # Fetch wrapper around the Apps Script Web App
│   ├── validation.js     # Client-side validation mirroring the backend
│   ├── ui.js              # DOM rendering (dashboard, list, modal, toasts)
│   └── app.js              # State management + event wiring
├── Code.gs               # Google Apps Script backend (REST API + Sheets DB)
└── README.md
```

### Data model (one row per task in the Sheet)

| Column | Type | Notes |
|---|---|---|
| ID | string (UUID) | generated server-side |
| Task | string, required, ≤200 chars | |
| Due Date | `YYYY-MM-DD` or empty | |
| Priority | `High` \| `Medium` \| `Low` | required |
| Status | `Not Started` \| `In Progress` \| `On Hold` \| `Completed` | defaults to `Not Started` |
| Notes | string, ≤2000 chars | optional |
| Created At | ISO timestamp | set once, server-side, on create |
| Updated At | ISO timestamp | refreshed server-side on every write |
| Completed At | ISO timestamp or empty | auto-set when Status becomes `Completed`, auto-cleared when it leaves `Completed` |

---

## 2. Deploy the backend (Google Apps Script)

1. Go to [sheets.google.com](https://sheets.google.com) and create a new, blank spreadsheet. Name it whatever you like (e.g. "Tasks Database"). You do **not** need to add headers manually — the script creates them.
2. Copy the **Spreadsheet ID** out of the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART_IS_THE_ID`**`/edit`
3. In the sheet, go to **Extensions → Apps Script**. Delete the placeholder `Code.gs` content and paste in the full contents of this repo's [`Code.gs`](./Code.gs).
4. Set your Spreadsheet ID securely as a **Script Property** (recommended, keeps it out of source control if you fork this publicly):
   - In the Apps Script editor: **Project Settings (gear icon) → Script Properties → Add script property**
   - Key: `SPREADSHEET_ID`, Value: *(paste the ID from step 2)*
   - Optionally also add `SHEET_NAME` (defaults to `Tasks` if omitted).
   - *(Alternative: just edit `CONFIG.SPREADSHEET_ID` directly at the top of `Code.gs` — simpler, but less clean for a public repo.)*
5. In the function dropdown at the top of the editor, select **`setup`** and click **Run** once. This creates the header row in your sheet. The first run will prompt you to authorize the script — accept the permissions (it only touches this one spreadsheet).
6. Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" → choose **Web app**.
   - Description: anything, e.g. "Tasks API v1".
   - **Execute as:** `Me (your account)`
   - **Who has access:** `Anyone`
   - Click **Deploy**, authorize again if prompted.
7. Copy the **Web app URL** shown (it ends in `/exec`). This is your API base URL.

> **Redeploying after code changes:** editing `Code.gs` does not update a live deployment automatically. Use **Deploy → Manage deployments → (pencil/edit icon) → New version → Deploy** to push changes to the same URL.

### Why "Execute as: Me / Anyone"?

This lets the script run with *your* permissions to read/write the Sheet (so end users never need their own Google account or OAuth), while still being publicly callable. Nothing sensitive is exposed: the frontend never sees the Spreadsheet ID, your account, or any API key — only the public `/exec` endpoint URL, which by design only exposes the task CRUD operations defined in `Code.gs`.

---

## 3. Configure the frontend

Open `js/api.js` and set:

```js
const API_CONFIG = Object.freeze({
  BASE_URL: 'https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXX/exec',
  TIMEOUT_MS: 15000,
});
```

Paste in the exact Web app URL from step 7 above. That's the only configuration required.

---

## 4. Run locally (optional)

Because this is static HTML/CSS/JS with no build step, you can just open `index.html` in a browser, or serve it locally:

```bash
cd todo-app
python3 -m http.server 8000
# visit http://localhost:8000
```

The app will talk directly to your deployed Apps Script backend — no local server needed for the API.

---

## 5. Deploy the frontend to GitHub Pages

1. Create a new GitHub repository (public or private — Pages works either way on a paid plan; public repos get Pages free).
2. Push the contents of `todo-app/` to the repo root (or to a `/docs` folder — your choice, see step 3).

   ```bash
   cd todo-app
   git init
   git add .
   git commit -m "Initial commit: todo app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

3. In the repo on GitHub: **Settings → Pages**.
   - **Source:** Deploy from a branch
   - **Branch:** `main`, folder `/ (root)` (or `/docs` if you used that)
   - Save.
4. GitHub gives you a URL like `https://<your-username>.github.io/<your-repo>/`. It can take a minute or two to go live.
5. Open it — your todo app is live, backed by your Google Sheet.

---

## 6. API reference

Base URL = your Apps Script `/exec` URL. Response envelope is always:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "code": null,
  "message": null,
  "timestamp": "2026-09-09T10:15:00+05:30"
}
```

### `GET ?action=list`
Query params (all optional): `search`, `status`, `priority`, `dueDate` (`overdue`|`today`|`week`|`none`), `sort` (`dueDate`|`priority`|`newest`|`oldest`|`updated`|`completed`).
Returns `data: Task[]`.

### `GET ?action=get&id=<id>`
Returns `data: Task`.

### `POST { action: "create", task: {...} }`
Body fields: `task` (required), `dueDate`, `priority` (required), `status`, `notes`.
Returns `data: Task` (with generated `id`, timestamps).

### `POST { action: "update", id: "<id>", task: {...} }`
Partial update — only send fields you want to change. Returns `data: Task`.

### `POST { action: "delete", id: "<id>" }`
Returns `data: { id }`.

All `POST` requests are sent with `Content-Type: text/plain` from the frontend intentionally — this keeps them as CORS "simple requests" so the browser doesn't send a preflight `OPTIONS` request, which Apps Script Web Apps don't reliably support.

---

## 7. Validation & security notes

- **Both layers validate:** `js/validation.js` gives instant inline feedback in the UI; `Code.gs`'s `validateTask()` is the source of truth and re-validates everything server-side regardless of what the client sent.
- **XSS safety:** all task data rendered into the DOM goes through `escapeHtml()` before being templated into `innerHTML`. The backend additionally strips HTML tags and control characters from `task` and `notes` on every write (defense in depth).
- **No secrets in frontend code:** the only thing `js/api.js` holds is the public Web App URL, which is meant to be public — it exposes only the CRUD operations defined in `Code.gs`, never the Spreadsheet ID, your Google account, or any credential.
- **Concurrency:** `Code.gs` uses `LockService` around writes to avoid race conditions if multiple people use the app at once.
- **Server-side timestamps:** `Created At`, `Updated At`, and `Completed At` are always set by the server (`Utilities.formatDate` in `Asia/Kolkata`), never trusted from client input.

---

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| "The backend URL is not configured yet" toast | You haven't set `API_CONFIG.BASE_URL` in `js/api.js` |
| Requests fail with a CORS error in the console | Make sure the deployment's "Who has access" is set to **Anyone**, and that you redeployed a **new version** after any `Code.gs` change |
| 401/permission errors on first load | Re-run `setup` from the Apps Script editor and accept the authorization prompt |
| Sheet has no header row | Run the `setup` function once from the Apps Script editor |
| Changes to `Code.gs` don't appear | You edited the script but didn't push a new deployment version (Deploy → Manage deployments → Edit → New version) |

---

## 9. License

Use, modify, and deploy freely for personal or commercial projects.
