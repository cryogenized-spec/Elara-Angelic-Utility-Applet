# Google Workspace Write Confirmation

Google Workspace reads execute without an extra confirmation. Mutations, destructive operations, and sends require explicit user confirmation at the application boundary before the handler can run.

The browser watchdog presents the registered tool name plus a safe human-readable resource summary. A multi-action proposal presents every mutation as an independently selectable item, with controls to **Approve selected**, **Approve all**, or **Decline** the entire proposal. A single proposed mutation uses the same watchdog with one selection.

Confirmation is separate from OAuth authorization. OAuth grants the application capability; the confirmation gate grants permission for this particular action. The model and Character Master cannot satisfy either boundary.

Confirmation requests are intentionally ephemeral. They are not persisted as authorization state. A request is time-bounded by the existing five-minute freshness policy, and aborted or dismissed requests resolve as declined.

Reads in the same Gemini tool turn continue through the normal read path. When Gemini proposes multiple mutations in one interaction, the application gathers the function calls into one confirmation round, executes only the approved items, and sends one grouped function-result continuation back to Gemini. Unselected mutations are represented as declined results and are never passed to their mutation handlers.

The grouping layer sits above the existing executor. The executor remains the final validation, OAuth, confirmation, and handler boundary, and approved browser actions are only executed with an already-granted capability.

Future Kanban/watchdog surfaces can project the same pending/completed mutation state without weakening this execution boundary.
