# Task: connect Sohan's work Outlook (Microsoft Graph)

You (Alfred) are executing this with Sohan live on chat. Work ONE step at
a time: do a step, tell him the result in one short line, move on. If a
step fails in a way this file doesn't cover, tell him to paste the exact
error to "the architect" (the Claude session that maintains this repo).

## Step 0 — sanity-check the config

Read `mcp.json` (it's in your working directory). Confirm the `ms365`
entry exists and its args include `"--org-mode"`.

- If the file or entry is missing, or `--org-mode` isn't there: Edit
  mcp.json to fix it, then tell Sohan: "config fixed — restart me
  (Ctrl-C, then `node whatsapp.js sohan`) and text me 'continue outlook
  setup'". STOP here; you'll resume after restart.

## Step 1 — check whether ms365 tools are even loaded

Do you have mcp__ms365__* tools available right now?

- NO → the gateway started before mcp.json existed. Tell Sohan to
  restart you (same command as above), then resume at Step 2.
- YES → Step 2.

## Step 2 — login

Call the ms365 `login` tool. It returns a URL (microsoft.com/devicelogin)
and a short code.

- Send Sohan EXACTLY: the URL, the code, and "sign in as
  spr@grandempirehk.com — you have ~10 minutes before the code expires."
- Wait for him to say he's done, then call `verify-login`.
- Success → Step 4. Failure → call `login` once more (codes expire fast;
  second attempt with a fresh code usually lands). Two failures → Step 3.

## Step 3 — failure triage

Ask Sohan what the Microsoft page said, then branch:

**"Code expired / invalid code"** → generate a fresh code (Step 2 again),
tell him to move quicker this time. This is the most common failure.

**"Need admin approval / administrator has not consented"** → the Grand
Empire tenant blocks third-party apps. Explain to Sohan in one line:
"the company Microsoft account needs a one-time approval from whoever
admins it — likely your dad's IT". Then DRAFT (do not send) a short
email to the admin for him, saying: an app using Microsoft's device-code
sign-in needs consent for Sohan's account; in Microsoft Entra admin
center → Enterprise applications → the app pending consent → Grant admin
consent. Offer the alternative if IT prefers control: register a
dedicated app in the tenant (Entra → App registrations → New; delegated
Graph permissions Mail.ReadWrite, Mail.Send, Calendars.ReadWrite,
offline_access; enable public client flows) and give Sohan the client id
+ tenant id — those go in mcp.json as env MS365_MCP_CLIENT_ID and
MS365_MCP_TENANT_ID.

**Login tool errors out locally (not a Microsoft page problem)** → tell
Sohan to run in a terminal:
`npx @softeria/ms-365-mcp-server --org-mode --login`
and follow the printed URL+code. The token lands in the same credential
store; after it succeeds, have him text you "try outlook now" and go to
Step 4.

**Anything else** → have Sohan paste the exact message to the architect.

## Step 4 — verify and record

1. List the 3 most recent inbox messages (subjects + senders only) and
   send them to Sohan as proof it works.
2. Append to today's journal entry: "Work Outlook (Graph) connected."
3. Remove this file's TODO status by telling Sohan: "outlook is live —
   this now feeds your morning briefing and my patrol."
4. If his Gmail setup (the GCP task) is still pending, remind him that's
   the last integration left.
