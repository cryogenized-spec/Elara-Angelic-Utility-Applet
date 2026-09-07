# Elara Durable Memory — User Guide

**Audience:** Elara users who want to understand what the Memory Bank is, what it remembers, how memory affects responses, and what the different memory permissions mean.

> **In plain English:** Elara's durable memory is a long-term notebook that can preserve useful information beyond a single conversation. The notebook is structured, searchable, scoped, and visible to you. When Elara prepares a response, the application can retrieve a small, relevant selection from that notebook and give it to Gemini as context. This helps Elara stay consistent and personal without stuffing your entire history into every prompt.

## What is the Memory Bank?

The **Memory Bank** is Elara's durable, structured memory store.

It is different from ordinary chat history. A chat transcript records what was said in a conversation. Durable memory is information deliberately kept because it may be useful again later: preferences, recurring facts, important context, project details, or other information that should remain available beyond one conversation.

The Memory Bank is designed around one important rule:

> **There is one authoritative memory store. Everything else is a view or a temporary use of that store.**

The Memory Bank screen, search and filtering, memory retrieval, and future memory tools are all intended to operate over that same collection. The application does not maintain a hidden second database just for the interface or another permanent copy of the memory context sent to Gemini.

## What does memory actually do for me?

Durable memory can make Elara's responses more useful in situations where continuity matters.

For example, suppose a useful preference has been saved:

> The user prefers concise explanations and normally uses dark mode.

Later, you start a new conversation and ask Elara to help with a UI design. The application can retrieve that relevant memory and include it in Elara's application-owned context. Elara can then take the preference into account without you needing to repeat it.

This is the basic cycle:

```text
You talk to Elara
      |
      v
Useful durable information is stored
      |
      v
The memory remains in the local durable store
      |
      v
A later request is made
      |
      v
The application finds relevant memories
      |
      v
A small bounded selection is supplied to Gemini
      |
      v
Elara answers with more continuity and context
```

Memory is therefore not meant to replace conversation. It is a **continuity layer** that helps important information survive beyond the moment in which it was mentioned.

## What is and is not automatically remembered?

This distinction is important.

### Ordinary chat history is not automatically permanent memory

The application does **not** treat every line of every conversation as a permanent memory record. That would produce a noisy, enormous memory store and would make it much harder to distinguish genuinely useful information from transient conversation.

Instead, durable memory is based on explicit memory operations and deliberate storage decisions.

This means a casual sentence in chat does not automatically become a permanent memory merely because it exists in the transcript.

### Memory can be explicitly created

The application provides a deliberate memory capability through which Elara can request that useful information be stored. The application, rather than the model, owns the durable identity, timestamps, validation, provenance, and persistence rules.

The user can also create and edit memories directly in **Settings → Memory Bank**.

### Observations are not the same as established memories

The memory system also supports **observations**. An observation is a small piece of evidence that may later help support, contradict, or add context to an established memory.

An observation does not silently replace an existing memory.

This gives the system a safer way to handle change. A new observation can say, in effect, "something happened that matters," without pretending that every new statement instantly invalidates everything remembered before it.

## The four kinds of memory

Every durable record has a memory kind. The kinds help the retrieval system understand what sort of information it is dealing with.

### `CORE`

Core memories represent especially durable, identity-level or foundational information that is expected to remain useful for a long time.

Examples:

- a stable personal preference;
- an enduring identity detail;
- a major long-term project fact;
- a foundational piece of context that should strongly influence future conversations.

Core does **not** mean "immutable." A core memory can still be edited, archived, superseded, or deleted.

### `CONTEXTUAL`

Contextual memories capture useful ongoing context that matters across conversations but is not necessarily foundational identity.

Examples:

- a current project and its goals;
- how you prefer a particular workflow to operate;
- an ongoing constraint or requirement;
- a recurring preference that is useful but not necessarily permanent.

### `EPISODIC`

Episodic memories capture notable events or experiences that may be useful later.

Examples:

- an important decision that was made;
- a significant event in an ongoing project;
- a memorable interaction that provides useful future context.

An episodic memory is about **something that happened**, rather than simply a standing fact.

### `MICRO_OBSERVATION`

Micro-observations are small pieces of evidence.

They are intentionally lightweight. Several observations may eventually support an established memory, reveal a contradiction, or simply provide related context.

They should be thought of as the system's **evidence layer**, not as a replacement for the main memory records.

## Memory lifecycle: Active, Dormant, Archived

A memory also has a lifecycle.

### Active

An active memory is currently eligible for normal retrieval.

This is the ordinary state for a memory that should be considered when relevant.

### Dormant

A dormant memory remains stored but is treated as less immediately active.

It is retained rather than destroyed. The lifecycle gives the system a way to keep information without treating everything in the notebook as equally important forever.

### Archived

Archived memories are retained in the durable store but excluded from normal retrieval.

Archiving is therefore a **reversible form of forgetting**. It is useful when a memory should no longer affect Elara's responses but you do not want to destroy the record permanently.

The Memory Bank lets you restore an archived record.

## What does "forget" mean?

The memory architecture deliberately distinguishes between **forgetting** and **deleting**.

**Forget / archive** means:

- keep the record;
- stop normal retrieval from using it;
- preserve it so it can be restored later.

**Delete** means:

- permanently remove the record from the durable memory store;
- treat the operation as irreversible.

The Memory Bank therefore asks for confirmation before permanent deletion.

When in doubt, archiving is the safer option because it preserves the data.

## Memory scope: Global vs folder/project context

Memories can have a **scope**.

A **Global** memory is not tied to one specific folder/project context. It is available as a candidate across relevant contexts when global retrieval is permitted.

A folder-scoped memory belongs to a particular workspace or project context. This helps prevent unrelated memories from leaking into another task.

For example, a memory about one software project should not automatically be treated as equally relevant while you are discussing an unrelated project.

This scope is part of the retrieval boundary, alongside lifecycle, expiry, and relevance.

## How does Elara decide which memories matter?

Elara does not receive the entire Memory Bank on every turn.

The application uses a dedicated retrieval engine that ranks candidates and enforces a hard budget before memory is added to the Gemini request.

The baseline ranking considers signals including:

- lexical relevance between your request and the memory's title, body, and tags;
- importance;
- confidence;
- reinforcement history;
- recency;
- memory kind;
- lifecycle;
- folder/project scope;
- explicit relationships between memories.

The current retrieval defaults are deliberately bounded:

- **up to 8 memory records** for a normal retrieval result;
- **up to 6,000 title/body characters** in the assembled memory context;
- absolute caps prevent larger caller-supplied limits from turning memory into an unbounded prompt expansion.

This is important for both quality and predictability. A large memory database does not mean a huge memory prompt.

## Why doesn't Elara just remember everything?

Because "everything" is not the same thing as "useful." 

A memory system that stores every sentence tends to accumulate noise, contradictions, obsolete details, and irrelevant context. Retrieval then becomes less reliable and prompts become bloated.

The architecture instead treats durable memory as a curated information layer:

```text
Conversation history
        |
        | explicit / deliberate memory operations
        v
Durable Memory Bank
        |
        | relevance + scope + lifecycle + confidence + importance
        v
Small retrieved context
        |
        v
Gemini response
```

The goal is **better context, not maximum context**.

## Confidence, importance, reinforcement, and recall

Memory records contain several signals that help the retrieval system make better choices.

### Confidence

Confidence represents how strongly the application should trust the recorded information.

A high-confidence memory is stronger evidence than a low-confidence one, all else being equal.

### Importance

Importance represents how valuable the information is to preserve and consider during retrieval.

A minor preference and a major long-term constraint should not necessarily compete on equal terms.

### Reinforcement

A memory can accumulate reinforcement when supporting evidence is deliberately consolidated into it.

This is one way the system can distinguish a repeatedly supported fact from a one-off statement.

Reinforcement is capped in the retrieval formula, so repeated reinforcement does not create an unlimited score advantage.

### Recall count

Recall count records how often a memory has actually been selected for retrieval.

This bookkeeping is separate from merely browsing the Memory Bank. Opening a memory in the settings interface does not mean the memory was used to answer a Gemini request.

## What happens when memories conflict?

The system is deliberately conservative about contradictions.

Suppose an established memory says:

> The user prefers dark mode.

Later, an observation says:

> The user explicitly requested light mode for this project.

The system does **not** silently overwrite the original memory simply because new evidence exists.

Instead, the contradictory observation can remain linked as **conflicting evidence**. This preserves the history of what the system knows and gives future logic a chance to decide whether the established memory should be revised or superseded.

There are three explicit consolidation relationships:

| Relationship | Meaning | Effect on target memory |
|---|---|---|
| `support` | The observation supports the established memory | Links the evidence and reinforces the target |
| `conflict` | The observation contradicts the established memory | Links the contradiction without rewriting the target |
| `related` | The observation is relevant context | Links the evidence without rewriting or reinforcing the target |

This is intentional. **Contradiction is represented rather than silently erased.**

## Permissions: who is allowed to do what?

The memory system has granular permissions for five mutation operations:

| Permission | Purpose |
|---|---|
| `save` | Create a durable memory record |
| `observe` | Record a micro-observation as evidence |
| `consolidate` | Link observations to established memories as support, conflict, or related evidence |
| `forget` | Archive a memory so it is retained but excluded from normal retrieval |
| `delete` | Permanently remove a memory |

There are also three actors in the policy model:

- **Model** — Elara/Gemini-facing memory operations.
- **User** — human-owned memory management.
- **System** — application-controlled operations.

The default policy is intentionally conservative:

| Actor | Save | Observe | Consolidate | Forget | Delete |
|---|---:|---:|---:|---:|---:|
| Model | ✅ | ✅ | ✅ | ❌ | ❌ |
| User | ✅ | ✅ | ✅ | ✅ | ✅ |
| System | ✅ | ✅ | ✅ | ✅ | ✅ |

### Why can't the model delete memories by default?

Because durable memory is user data.

A model should be able to propose useful memories and work with evidence without having unrestricted authority to destroy the user's long-term context.

That is why model-initiated `forget` and `delete` are denied by default, while explicit user actions remain available.

The permission check happens before the mutation reaches the durable store. Storage primitives do not bypass the authorization boundary.

> **Important:** this documentation describes the application's current permission architecture. The Memory Bank UI currently gives the human user direct management controls, but there is not yet a separate user-facing permission-settings panel for changing the underlying actor policy.

## What does the application own vs what does Elara own?

This boundary is one of the most important parts of the design.

Elara/Gemini can provide the meaningful content of a memory request: what the memory is about, what text should be stored, and lightweight classification such as kind or tags.

The application remains responsible for the durable mechanics:

- generating the memory identifier;
- timestamps;
- normalization;
- schema validation;
- provenance;
- folder scope supplied by the application context;
- permission checks;
- persistence;
- lifecycle handling;
- retrieval budgets.

This separation prevents the model from becoming the database administrator for its own memory.

## Provenance: where did a memory come from?

Durable memories carry structured provenance.

The source categories include:

- `user` — explicitly created or edited by the user;
- `elara` — explicitly proposed by Elara through the memory capability;
- `import` — reserved for future explicit import workflows;
- `migration` — reserved for future transformations from older representations.

Provenance helps keep "who supplied this information?" separate from the actual memory text.

## Privacy and storage model

The current durable-memory store is backed by the application's local IndexedDB persistence layer. The architecture is designed so the Memory Bank is a local, authoritative store rather than a separate cloud memory database.

Gemini receives only the bounded memory context selected for the current request through the existing provider path. The complete Memory Bank is not inserted into every request.

Memory retrieval is also **best-effort**. If memory lookup, folder resolution, or another memory-related step fails, the application is designed to continue the chat request without durable-memory context rather than making memory failure break normal conversation.

## What you can do in Memory Bank

Open **Settings → Memory Bank** to inspect your durable memories.

From there you can:

- search titles, bodies, and tags;
- filter by lifecycle;
- filter by memory kind;
- filter for global-scope records;
- expand a record to read its full Markdown-formatted body;
- edit the stored record;
- archive an active memory;
- restore an archived memory;
- promote a memory to a stronger kind;
- permanently delete a memory after confirmation;
- create a new durable memory yourself.

The interface is an inspection and management view over the canonical store. Searching and browsing do not create a second copy of the memory database.

## A note about Markdown

Memory bodies support Markdown so that structured notes remain readable.

For example, a memory can contain headings, lists, emphasis, code snippets, and other supported Markdown formatting. The formatting is presentation; the stored body remains the actual durable text.

## What happens if stored data becomes malformed?

The application includes a read-only memory health scan for long-term integrity checking.

If a malformed record is found, the health layer reports it rather than silently deleting or rewriting it. This is deliberate: automatic destructive repair could erase user data or hide the reason a record became invalid.

A future explicit migration/import workflow can use the same validation boundary to perform controlled recovery.

## What memory does *not* currently promise

Durable memory is intentionally narrower than a human-like autobiographical memory system.

It does not currently promise:

- that every conversation detail will be remembered;
- that every statement in chat automatically becomes durable;
- that every memory will be retrieved every time it is relevant;
- that contradictions are automatically resolved into one "true" record;
- that the model can freely delete or forget durable memories;
- that memory failures can never occur;
- that the application maintains a hidden, unlimited semantic archive of all past conversations.

These constraints are features of the current design, not missing documentation.

## How memory improves responses in practice

The intended benefit is continuity with restraint.

Without durable memory:

```text
New conversation
   -> Elara sees the current request
   -> old useful context may be absent
   -> you repeat yourself
```

With durable memory:

```text
New conversation
   -> application checks the relevant memory scope
   -> high-value memories are ranked
   -> only a bounded set is selected
   -> Gemini receives that context
   -> Elara can respond with continuity
```

That can improve things such as:

- remembering stable preferences;
- maintaining project context;
- avoiding repeated explanations;
- keeping terminology and decisions consistent;
- using previously recorded constraints;
- carrying important context into later conversations.

The retrieval engine is deliberately designed to favor **relevance and signal over volume**.

## The mental model to keep

Think of Elara's Memory Bank as three layers working together:

### 1. The notebook

The durable store is the notebook. It holds the structured records.

### 2. The librarian

The retrieval engine is the librarian. It decides which small selection of records is relevant to the current request and stays inside hard limits.

### 3. The conversation

Gemini receives the librarian's selected context alongside the current request. Elara can then use that information to produce a more context-aware answer.

The notebook is durable. The librarian's selection is temporary. The conversation remains the conversation.

## Quick FAQ

### "Why didn't Elara remember something I said?"

Because ordinary conversation is not automatically permanent memory. The information may not have been deliberately stored, may be outside the current scope, may be archived/expired, or may simply not have ranked highly enough for the current request.

### "Why did Elara remember something I wasn't talking about?"

Retrieval is ranking-based rather than perfect. The baseline considers relevance plus other signals such as importance, confidence, recency, reinforcement, kind, and scope. The Memory Bank exists so you can inspect exactly what durable records exist.

### "Can I see what Elara remembers?"

Yes. Open **Settings → Memory Bank**.

### "Can I remove a memory?"

Yes. You can archive it for reversible forgetting or permanently delete it from the Memory Bank.

### "Can Elara delete my memories on its own?"

Not by default. Model `forget` and `delete` permissions are disabled in the default policy.

### "Does looking at a memory count as Elara using it?"

No. Human inspection uses a browsing path that does not increment retrieval recall bookkeeping merely because you opened a record in Settings.

### "Does the entire Memory Bank get sent to Gemini?"

No. Retrieval selects a bounded subset for the current request.

### "Can memories contradict each other?"

Yes. The architecture intentionally preserves conflicting evidence instead of silently overwriting established memory.

### "Can I trust every memory equally?"

No durable memory system should be treated as infallible. Memory records include confidence and importance, and the retrieval engine uses those signals. The Memory Bank also lets you inspect and correct the underlying records yourself.

## Summary

Elara's durable memory is designed to make long-term conversation **more coherent without becoming opaque or unlimited**.

The core principles are:

1. **One canonical store.** There is one authoritative durable memory collection.
2. **Deliberate persistence.** Ordinary chat history is not automatically converted into permanent memory.
3. **Human visibility.** You can inspect and manage the records in Memory Bank.
4. **Bounded retrieval.** Only a small, relevant selection is supplied to Gemini.
5. **Explicit permissions.** Memory mutation is permission-gated, with model deletion/forgetting denied by default.
6. **Evidence over silent overwrite.** Supporting and conflicting observations remain representable.
7. **Scope matters.** Global and folder/project memories are kept distinct during retrieval.
8. **Failures stay non-fatal.** Memory problems should not prevent an otherwise valid chat response.
9. **Durability over cleverness.** The system favors inspectable, testable behavior over hidden magic.

The result is a memory system intended to behave less like a giant transcript and more like a carefully maintained notebook: **small enough to stay useful, explicit enough to inspect, and structured enough to grow with Elara over time.**

---

## Technical companion

This user guide explains the feature from a user perspective. For the implementation contract, module boundaries, retrieval scoring model, persistence rules, and architectural completion criteria, see [`MEMORY_ARCHITECTURE.md`](./MEMORY_ARCHITECTURE.md).
