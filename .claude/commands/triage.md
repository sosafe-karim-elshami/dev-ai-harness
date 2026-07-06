Find and answer un-answered support requests.

Invoke the **harness-support-triage** skill. It reads the profile for the user's Slack support channels and Jira support queue, surfaces the unanswered queue (per `triage-rubric.md`), and drafts grounded replies (checking `knowledge/`, cloned repos in `workspace/`, and Confluence first).

Drafts only — nothing is posted without explicit confirmation, and the guard hook gates any send. After a confirmed answer, it offers to save a reusable `knowledge/` entry.

If the user names a channel or ticket, scope to that. Otherwise scan all support channels in the profile.
