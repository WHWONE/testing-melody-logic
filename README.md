# Melody Logic Piano Roll

This repository hosts the piano-roll demo with the left-side keyboard visualization. Key files:

- `index.html`: layout, styles, and keyboard column markup.
- `app.js`: piano-roll rendering logic, including keyboard sizing.
- `audioEngine.js`, `melodyEngine.js`, `samplerWorklet.js`, `samples/`: audio and sequencing assets.

## Viewing the latest changes locally
1. From the repository root, start a simple server (for example):
   ```bash
   python3 -m http.server 8000
   ```
2. Open http://localhost:8000 in your browser. You should see the left-side keyboard with sculpted black keys.

## Branches and why you might see multiple
- It’s normal to have several branches (feature work, fixes, experiments). Run `git branch -a` to list locals and remotes.
- The latest keyboard changes live on the currently checked-out branch `work`. If you view a different branch (e.g., `main`), you will not see these updates.

## When changes don’t appear
- Make sure you are on the correct branch: `git status` shows the branch name on the first line.
- If a merge prompt appears and you choose **“accept incoming”** for all conflicts, you may replace the current branch’s edits with the other branch’s version. In this project, that could reintroduce the older flat black keys. To keep the new styling, ensure the branch containing the sculpted keys is the one whose changes you keep.
- After resolving conflicts, reload the page from your local server or redeploy so the updated files are served.

## Deployment note
This workspace reflects the current branch in this repository. If you publish to a hosting service, deploy from the branch that contains the desired keyboard visuals (here, `work`).
